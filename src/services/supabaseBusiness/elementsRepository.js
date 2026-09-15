import { executeSupabaseRpc } from "./supabaseRpcClient";
import { supabase } from "../auth/supabaseClient";
import {
  mapCreateElementInput,
  mapElementDetails,
  mapElementSearchItem,
} from "./mappers";
import { createRequestId } from "./requestId";
import { calculateAge, getElementGroup } from "../../utils/elementGroups";

const ALLOWED_INCLUDES = new Set(["profile", "documents"]);
const DOCUMENTS_BUCKET =
  import.meta.env.VITE_SUPABASE_DOCUMENTS_BUCKET || "element-documents";
const EDITABLE_ELEMENT_FIELDS = Object.freeze({
  Nombres: {
    column: "given_names",
    required: true,
    normalize: normalizeRequiredText,
  },
  ApellidoPaterno: {
    column: "paternal_surname",
    required: true,
    normalize: normalizeRequiredText,
  },
  ApellidoMaterno: {
    column: "maternal_surname",
    normalize: normalizeOptionalText,
  },
  Enfermedades: {
    column: "medical_notes",
    normalize: normalizeOptionalText,
  },
  FechaNacimiento: {
    column: "birth_date",
    required: true,
    normalize: normalizeBirthDate,
  },
  Sexo: {
    column: "sex_code",
    required: true,
    normalize: normalizeSexCode,
  },
  Tutor: {
    column: "guardian_name",
    required: true,
    normalize: normalizeRequiredText,
  },
  TelefonoTutor: {
    column: "guardian_phone",
    required: true,
    normalize: normalizeGuardianPhone,
  },
});
const ELEMENT_LIST_COLUMNS = Object.freeze([
  "id",
  "element_code",
  "given_names",
  "paternal_surname",
  "maternal_surname",
  "birth_date",
  "sex_code",
  "group_code",
  "guardian_name",
  "guardian_phone",
  "is_self_tutor",
  "enrolled_on",
  "billing_start_on",
  "billing_policy",
  "status",
  "created_at",
]);

function normalizeRequiredText(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error("Este campo es obligatorio.");
  return normalized;
}

function normalizeOptionalText(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function normalizeBirthDate(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error("Captura una fecha de nacimiento válida.");
  }
  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime()) || date > new Date()) {
    throw new Error("La fecha de nacimiento no puede ser futura.");
  }
  return normalized;
}

function normalizeGuardianPhone(value) {
  const normalized = String(value ?? "").replace(/\D/g, "");
  if (!/^\d{10}$/.test(normalized)) {
    throw new Error("El teléfono debe contener exactamente 10 dígitos.");
  }
  return normalized;
}

function normalizeSexCode(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!["F", "M"].includes(normalized)) {
    throw new Error("Selecciona un sexo válido.");
  }
  return normalized;
}

function getFullNameFromElement(element) {
  return [
    element?.given_names ?? element?.givenNames,
    element?.paternal_surname ?? element?.paternalSurname,
    element?.maternal_surname ?? element?.maternalSurname,
  ]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" ");
}

function getStorageObjectPath(document) {
  const value = document?.drive_file_id ?? document?.driveFileId ?? "";
  const prefix = `storage:${DOCUMENTS_BUCKET}/`;
  if (typeof value !== "string" || !value.startsWith(prefix)) return "";
  return value.slice(prefix.length);
}

async function createDocumentAccessUrl(document) {
  const directUrl = document?.drive_url ?? document?.driveUrl ?? "";
  if (directUrl) return directUrl;

  const objectPath = getStorageObjectPath(document);
  if (!objectPath) return "";

  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(objectPath, 60 * 10);

  if (error) return "";
  return data?.signedUrl || "";
}

async function loadElementDocumentsWithUrls(elementId) {
  const { data, error } = await supabase
    .from("element_documents")
    .select(
      [
        "id",
        "document_type",
        "drive_file_id",
        "drive_url",
        "original_filename",
        "mime_type",
        "size_bytes",
        "status",
        "version",
        "uploaded_at",
      ].join(",")
    )
    .eq("element_id", elementId)
    .in("status", ["active", "replaced"])
    .order("document_type", { ascending: true })
    .order("version", { ascending: false });

  if (error || !Array.isArray(data)) return null;

  return Promise.all(
    data.map(async (document) => {
      const downloadUrl = await createDocumentAccessUrl(document);
      return {
        documentId: document.id,
        type: document.document_type,
        fileName: document.original_filename,
        mimeType: document.mime_type,
        sizeBytes: document.size_bytes,
        status: document.status,
        version: document.version,
        uploadedAt: document.uploaded_at,
        downloadUrl,
        driveUrl: document.drive_url || "",
        driveFileId: document.drive_file_id || "",
        storageObjectPath: getStorageObjectPath(document),
      };
    })
  );
}

async function loadElementProfileExtras(elementId) {
  const [profileResult, assetJobResult] = await Promise.all([
    supabase
      .from("elements")
      .select("is_self_tutor")
      .eq("id", elementId)
      .single(),
    supabase
      .from("element_asset_jobs")
      .select("status, attempts, last_error_code, updated_at")
      .eq("element_id", elementId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (profileResult.error) return {};

  return {
    isSelfTutor: Boolean(profileResult.data?.is_self_tutor),
    ...(!assetJobResult.error && assetJobResult.data
      ? {
          assetJobStatus: assetJobResult.data.status,
          assetJobAttempts: assetJobResult.data.attempts,
          assetJobErrorCode: assetJobResult.data.last_error_code,
          assetJobUpdatedAt: assetJobResult.data.updated_at,
        }
      : {}),
  };
}

function validationError(message, fieldErrors = {}) {
  return {
    ok: false,
    code: "VALIDATION_ERROR",
    message,
    fieldErrors,
    raw: null,
  };
}

function invalidResponse(message, raw) {
  return {
    ok: false,
    code: "INVALID_RESPONSE",
    message,
    raw,
  };
}

export async function searchElementsSupabase({
  query,
  limit = 20,
  cursor = null,
} = {}) {
  const normalizedQuery = typeof query === "string" ? query.trim() : "";

  if (normalizedQuery.length < 2 || normalizedQuery.length > 100) {
    return validationError("Ingresa entre 2 y 100 caracteres para buscar.", {
      query: "La búsqueda debe contener entre 2 y 100 caracteres.",
    });
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return validationError("El límite debe ser un entero entre 1 y 50.");
  }
  if (cursor !== null && typeof cursor !== "string") {
    return validationError("El cursor de búsqueda no es válido.");
  }

  const result = await executeSupabaseRpc("search_elements", {
    p_query: normalizedQuery,
    p_limit: limit,
    p_status: "active",
  });
  if (!result.ok) return result;

  if (!Array.isArray(result.data.items)) {
    return invalidResponse("Supabase no devolvió una lista de elementos.", result.raw);
  }

  const items = result.data.items.map(mapElementSearchItem);
  if (items.some((item) => item === null)) {
    return invalidResponse(
      "Supabase devolvió un elemento sin identificador válido.",
      result.raw
    );
  }

  return {
    ...result,
    data: items,
    pagination: {
      limit: result.data.limit ?? limit,
      hasMore: Boolean(result.data.hasMore),
      nextCursor: null,
    },
  };
}

export async function listElementsSupabase({
  limit = 500,
  status = "active",
} = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return validationError("El límite debe ser un entero entre 1 y 500.");
  }
  if (status !== null && !["active", "inactive", "archived"].includes(status)) {
    return validationError("El estado solicitado no es válido.");
  }

  const createListQuery = (columns) => {
    let query = supabase
      .from("elements")
      .select(columns.join(","))
      .order("given_names", { ascending: true })
      .order("paternal_surname", { ascending: true })
      .order("maternal_surname", { ascending: true })
      .limit(limit);

    if (status !== null) {
      query = query.eq("status", status);
    }

    return query;
  };

  const { data, error } = await createListQuery(ELEMENT_LIST_COLUMNS);

  if (error) {
    return {
      ok: false,
      code: error.code || "SUPABASE_QUERY_ERROR",
      message: "No se pudo cargar la lista de elementos desde Supabase.",
      raw: error,
    };
  }

  if (!Array.isArray(data)) {
    return invalidResponse("Supabase no devolvió una lista de elementos.", data);
  }

  const items = data.map(mapElementSearchItem);
  if (items.some((item) => item === null)) {
    return invalidResponse(
      "Supabase devolvió un elemento sin identificador válido.",
      data
    );
  }

  return {
    ok: true,
    data: items,
    raw: data,
    integration: "supabase-business",
    pagination: {
      limit,
      hasMore: data.length === limit,
      nextCursor: null,
    },
  };
}

export async function getElementSupabase({
  elementId,
  include = ["profile", "documents"],
} = {}) {
  const normalizedElementId =
    typeof elementId === "string" ? elementId.trim() : "";

  if (!normalizedElementId || normalizedElementId.length > 100) {
    return validationError("El identificador del elemento no es válido.");
  }
  if (
    !Array.isArray(include) ||
    new Set(include).size !== include.length ||
    include.some((section) => !ALLOWED_INCLUDES.has(section))
  ) {
    return validationError("Las secciones solicitadas no son válidas.");
  }

  const result = await executeSupabaseRpc("get_element", {
    p_element_id: normalizedElementId,
  });
  if (!result.ok) return result;

  const element = mapElementDetails(result.data);
  if (!element) {
    return invalidResponse("Supabase no devolvió un expediente válido.", result.raw);
  }

  const documentsWithUrls = include.includes("documents")
    ? await loadElementDocumentsWithUrls(normalizedElementId)
    : null;
  const profileExtras = await loadElementProfileExtras(normalizedElementId);
  const normalizedElement = mapElementDetails({
    ...result.data,
    element: {
      ...result.data.element,
      ...profileExtras,
    },
    ...(documentsWithUrls ? { documents: documentsWithUrls } : {}),
  });

  return {
    ...result,
    data: normalizedElement,
  };
}

export async function updateElementFieldSupabase({
  elementId,
  field,
  value,
} = {}) {
  const normalizedElementId =
    typeof elementId === "string" ? elementId.trim() : "";
  const fieldConfig = EDITABLE_ELEMENT_FIELDS[field];

  if (!normalizedElementId) return validationError("Selecciona un elemento válido.");
  if (!fieldConfig) return validationError("El campo no se puede editar desde esta vista.");

  let normalizedValue;
  try {
    normalizedValue = fieldConfig.normalize(value);
  } catch (error) {
    return validationError(error.message, { [field]: error.message });
  }

  const updatePayload = {
    [fieldConfig.column]: normalizedValue,
  };

  const { data: current, error: currentError } = await supabase
    .from("elements")
    .select("given_names, paternal_surname, maternal_surname, birth_date, sex_code, is_self_tutor")
    .eq("id", normalizedElementId)
    .single();

  if (currentError) {
    return {
      ok: false,
      code: currentError.code || "SUPABASE_QUERY_ERROR",
      message: "No se pudo validar el expediente del elemento.",
      raw: currentError,
    };
  }

  if (field === "Tutor" && current?.is_self_tutor) {
    return validationError(
      "Para cambiar el tutor, primero desmarca la opción de propio tutor."
    );
  }

  if (field === "FechaNacimiento") {
    if (current?.is_self_tutor && calculateAge(normalizedValue) < 18) {
      return validationError(
        "Un elemento menor de edad no puede quedar marcado como su propio tutor."
      );
    }
    updatePayload.group_code =
      getElementGroup({
        birthDate: normalizedValue,
        sex: current?.sex_code,
      })?.label ?? null;
  }

  if (field === "Sexo") {
    updatePayload.group_code =
      getElementGroup({
        birthDate: current?.birth_date,
        sex: normalizedValue,
      })?.label ?? null;
  }

  if (
    current?.is_self_tutor &&
    ["Nombres", "ApellidoPaterno", "ApellidoMaterno"].includes(field)
  ) {
    updatePayload.guardian_name = getFullNameFromElement({
      ...current,
      [fieldConfig.column]: normalizedValue,
    });
  }

  const { error } = await supabase
    .from("elements")
    .update(updatePayload)
    .eq("id", normalizedElementId);

  if (error) {
    return {
      ok: false,
      code: error.code || "SUPABASE_UPDATE_ERROR",
      message: "No se pudo actualizar el expediente en Supabase.",
      raw: error,
    };
  }

  const refreshed = await getElementSupabase({
    elementId: normalizedElementId,
    include: ["profile", "documents"],
  });

  return {
    ...refreshed,
    message: "Campo actualizado correctamente.",
  };
}

export async function setElementSelfTutorSupabase({
  elementId,
  enabled,
  guardianName = "",
  guardianPhone = "",
} = {}) {
  const normalizedElementId =
    typeof elementId === "string" ? elementId.trim() : "";

  if (!normalizedElementId) return validationError("Selecciona un elemento válido.");

  const { data: current, error: currentError } = await supabase
    .from("elements")
    .select("given_names, paternal_surname, maternal_surname, birth_date, guardian_phone")
    .eq("id", normalizedElementId)
    .single();

  if (currentError) {
    return {
      ok: false,
      code: currentError.code || "SUPABASE_QUERY_ERROR",
      message: "No se pudo validar el expediente del elemento.",
      raw: currentError,
    };
  }

  const updatePayload = {};

  if (enabled) {
    if (calculateAge(current?.birth_date) < 18) {
      return validationError("Solo un elemento mayor de edad puede ser su propio tutor.");
    }

    const selfTutorName = getFullNameFromElement(current);
    if (!selfTutorName) return validationError("Completa el nombre del elemento primero.");

    let normalizedPhone;
    try {
      normalizedPhone = normalizeGuardianPhone(guardianPhone || current?.guardian_phone);
    } catch (error) {
      return validationError(error.message);
    }

    updatePayload.is_self_tutor = true;
    updatePayload.guardian_name = selfTutorName;
    updatePayload.guardian_phone = normalizedPhone;
  } else {
    let normalizedGuardianName;
    let normalizedGuardianPhone;

    try {
      normalizedGuardianName = normalizeRequiredText(guardianName);
      normalizedGuardianPhone = normalizeGuardianPhone(guardianPhone);
    } catch (error) {
      return validationError(error.message);
    }

    updatePayload.is_self_tutor = false;
    updatePayload.guardian_name = normalizedGuardianName;
    updatePayload.guardian_phone = normalizedGuardianPhone;
  }

  const { error } = await supabase
    .from("elements")
    .update(updatePayload)
    .eq("id", normalizedElementId);

  if (error) {
    return {
      ok: false,
      code: error.code || "SUPABASE_UPDATE_ERROR",
      message: "No se pudo actualizar la relación de tutor.",
      raw: error,
    };
  }

  const refreshed = await getElementSupabase({
    elementId: normalizedElementId,
    include: ["profile", "documents"],
  });

  return {
    ...refreshed,
    message: enabled
      ? "El elemento quedó marcado como su propio tutor."
      : "Se asignó un nuevo tutor correctamente.",
  };
}

export async function cancelElementDocumentSupabase({
  elementId,
  documentId,
} = {}) {
  const normalizedElementId =
    typeof elementId === "string" ? elementId.trim() : "";
  const normalizedDocumentId =
    typeof documentId === "string" ? documentId.trim() : "";

  if (!normalizedElementId) return validationError("Selecciona un elemento válido.");
  if (!normalizedDocumentId) return validationError("Selecciona un documento válido.");

  const { error } = await supabase
    .from("element_documents")
    .update({ status: "cancelled" })
    .eq("id", normalizedDocumentId)
    .eq("element_id", normalizedElementId)
    .eq("status", "active");

  if (error) {
    return {
      ok: false,
      code: error.code || "SUPABASE_UPDATE_ERROR",
      message: "No se pudo retirar el documento del expediente.",
      raw: error,
    };
  }

  const refreshed = await getElementSupabase({
    elementId: normalizedElementId,
    include: ["profile", "documents"],
  });

  return {
    ...refreshed,
    message: "Documento eliminado correctamente.",
  };
}

export async function completeElementAssetsSupabase({
  requestId,
  elementId,
  assets,
} = {}) {
  const driveFolder = assets?.data?.driveFolder ?? assets?.driveFolder;
  const qr = assets?.data?.qr ?? assets?.qr;
  const documents = assets?.data?.documents ?? assets?.documents ?? [];

  if (!requestId || !elementId || !driveFolder?.id || !driveFolder?.url) {
    return validationError("La automatización no devolvió una carpeta válida.");
  }

  const result = await executeSupabaseRpc("complete_element_assets", {
    p_request_id: requestId,
    p_element_id: elementId,
    p_drive_folder_id: driveFolder.id,
    p_drive_folder_url: driveFolder.url,
    p_qr_value: qr?.value || `pdmu:element:${elementId}`,
    p_documents: Array.isArray(documents) ? documents : [],
  });

  if (!result.ok) return result;

  return {
    ...result,
    requestId,
    message: "Carpeta y documentos vinculados correctamente.",
  };
}

export async function createElementSupabase(input = {}) {
  let requestId;
  try {
    requestId = input.requestId || createRequestId();
  } catch (error) {
    return {
      ok: false,
      code: "REQUEST_ID_UNAVAILABLE",
      message: error.message,
      raw: error,
    };
  }

  const result = await executeSupabaseRpc("create_element", {
    p_request_id: requestId,
    ...mapCreateElementInput(input),
  });
  if (!result.ok) return result;

  let element = result.data.element;
  if (!element || typeof element.elementId !== "string") {
    return invalidResponse("Supabase no confirmó el elemento creado.", result.raw);
  }

  if (input?.selfTutor) {
    const selfTutorName = getFullNameFromElement({
      givenNames: input?.nombre ?? input?.givenNames,
      paternalSurname: input?.apellidoPaterno ?? input?.paternalSurname,
      maternalSurname: input?.apellidoMaterno ?? input?.maternalSurname,
    });

    const { error } = await supabase
      .from("elements")
      .update({
        is_self_tutor: true,
        ...(selfTutorName ? { guardian_name: selfTutorName } : {}),
      })
      .eq("id", element.elementId);

    if (error) {
      return {
        ok: false,
        code: error.code || "SUPABASE_UPDATE_ERROR",
        message: "La inscripción se creó, pero no se pudo marcar como propio tutor.",
        raw: error,
      };
    }

    element = {
      ...element,
      isSelfTutor: true,
    };
  }

  return {
    ...result,
    data: element,
    requestId,
    message: element.reactivated
      ? "El elemento existente se reactivó con una nueva inscripción."
      : "La inscripción se guardó correctamente.",
  };
}

export async function deactivateElementSupabase({
  elementId,
  reason,
  droppedOn = null,
  requestId = null,
} = {}) {
  const normalizedElementId =
    typeof elementId === "string" ? elementId.trim() : "";
  const normalizedReason = typeof reason === "string" ? reason.trim() : "";

  if (!normalizedElementId) return validationError("Selecciona un elemento válido.");
  if (!normalizedReason) return validationError("Captura el motivo de baja.");

  let operationId;
  try {
    operationId = requestId || createRequestId();
  } catch (error) {
    return {
      ok: false,
      code: "REQUEST_ID_UNAVAILABLE",
      message: error.message,
      raw: error,
    };
  }

  const result = await executeSupabaseRpc("deactivate_element", {
    p_request_id: operationId,
    p_element_id: normalizedElementId,
    p_reason: normalizedReason,
    p_dropped_on: droppedOn || null,
  });
  if (!result.ok) return result;

  return {
    ...result,
    requestId: operationId,
    data: result.data.element,
    message: "El elemento se dio de baja y la inscripción activa quedó cerrada.",
  };
}

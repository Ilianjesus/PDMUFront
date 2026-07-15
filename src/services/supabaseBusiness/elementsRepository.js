import { executeSupabaseRpc } from "./supabaseRpcClient";
import { supabase } from "../auth/supabaseClient";
import {
  mapCreateElementInput,
  mapElementDetails,
  mapElementSearchItem,
} from "./mappers";
import { createRequestId } from "./requestId";

const ALLOWED_INCLUDES = new Set(["profile", "documents"]);

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

  let query = supabase
    .from("elements")
    .select(
      [
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
        "enrolled_on",
        "billing_start_on",
        "billing_policy",
        "status",
        "created_at",
      ].join(",")
    )
    .order("given_names", { ascending: true })
    .order("paternal_surname", { ascending: true })
    .order("maternal_surname", { ascending: true })
    .limit(limit);

  if (status !== null) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
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

  return {
    ...result,
    data: element,
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

  const element = result.data.element;
  if (!element || typeof element.elementId !== "string") {
    return invalidResponse("Supabase no confirmó el elemento creado.", result.raw);
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

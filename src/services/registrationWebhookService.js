import { calculateAge, getElementGroup } from "../utils/elementGroups";

export const REGISTRATION_DOCUMENTS = Object.freeze([
  {
    key: "actaNacimiento",
    type: "birth_certificate",
    label: "Acta de nacimiento",
  },
  {
    key: "curp",
    type: "curp",
    label: "CURP del elemento",
  },
  {
    key: "certificadoMedico",
    type: "medical_certificate",
    label: "Certificado médico",
  },
  {
    key: "hojaInscripcion",
    type: "enrollment_form",
    label: "Hoja de inscripción",
  },
  {
    key: "ineTutor",
    type: "guardian_id",
    label: "INE del tutor",
  },
  {
    key: "comprobanteDomicilio",
    type: "proof_of_address",
    label: "Comprobante de domicilio",
  },
]);

const REGISTRATION_WEBHOOK_URL =
  import.meta.env.VITE_N8N_WEBHOOK_INSCRIPCION ||
  "https://n8n.scolaris.com.mx/webhook/pdmu/inscripciones";

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function mapSexCode(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (["f", "femenino", "femenil", "femeni"].includes(normalized)) return "F";
  if (["m", "masculino", "varonil"].includes(normalized)) return "M";
  return normalizeText(value);
}

function getFileExtension(file) {
  const nameExtension = file?.name?.split(".").pop();
  if (nameExtension && nameExtension !== file.name) return nameExtension.toLowerCase();
  if (file?.type === "application/pdf") return "pdf";
  return "bin";
}

function createNormalizedFileName(documentType, file) {
  return `${documentType}.${getFileExtension(file)}`;
}

function isFileLike(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.name === "string" &&
    typeof value.size === "number" &&
    typeof value.type === "string"
  );
}

export function hasRegistrationDocuments(files = {}) {
  return REGISTRATION_DOCUMENTS.some(({ key }) => isFileLike(files[key]));
}

export async function submitRegistrationWebhook({
  elementData,
  files = {},
  supabaseElement,
  requestId,
}) {
  const sexCode = mapSexCode(elementData?.sexo ?? elementData?.sexCode);
  const birthDate = elementData?.fechaNacimiento ?? elementData?.birthDate ?? "";
  const age = calculateAge(birthDate);
  const group = getElementGroup({ birthDate, sex: sexCode });

  const documents = REGISTRATION_DOCUMENTS.map(({ key, type, label }) => {
    const file = files[key];
    const hasFile = isFileLike(file);
    return {
      field: key,
      document_type: type,
      label,
      received: hasFile,
      file_name: hasFile ? file.name : null,
      normalized_file_name:
        hasFile ? createNormalizedFileName(type, file) : null,
      mime_type: hasFile ? file.type : null,
      size_bytes: hasFile ? file.size : null,
    };
  });

  const payload = {
    source: "pdmu-front",
    submitted_at: new Date().toISOString(),
    request_id: requestId ?? null,
    supabase: {
      element_id: supabaseElement?.elementId ?? null,
      element_code: supabaseElement?.elementCode ?? null,
      enrollment_id: supabaseElement?.enrollmentId ?? null,
      enrollment_code: supabaseElement?.enrollmentCode ?? null,
      reactivated: Boolean(supabaseElement?.reactivated),
    },
    element: {
      given_names: normalizeText(elementData?.nombre ?? elementData?.givenNames),
      paternal_surname: normalizeText(
        elementData?.apellidoPaterno ?? elementData?.paternalSurname
      ),
      maternal_surname: normalizeText(
        elementData?.apellidoMaterno ?? elementData?.maternalSurname
      ),
      birth_date: birthDate || null,
      age_years: age,
      sex_code: sexCode,
      group: group?.label ?? null,
      medical_notes: normalizeText(elementData?.enfermedades ?? elementData?.medicalNotes),
    },
    guardian: {
      name: normalizeText(elementData?.tutor ?? elementData?.guardianName),
      phone: normalizeText(elementData?.telefonoTutor ?? elementData?.guardianPhone),
    },
    documents,
  };

  const body = new FormData();
  body.append("payload", JSON.stringify(payload));
  body.append("request_id", payload.request_id ?? "");
  body.append("element_id", payload.supabase.element_id ?? "");
  body.append("element_code", payload.supabase.element_code ?? "");
  body.append("documents_count", String(documents.filter((document) => document.received).length));

  for (const { key, type } of REGISTRATION_DOCUMENTS) {
    const file = files[key];
    if (isFileLike(file)) {
      body.append(type, file, createNormalizedFileName(type, file));
    }
  }

  const response = await fetch(REGISTRATION_WEBHOOK_URL, {
    method: "POST",
    body,
    mode: "no-cors",
  });

  if (response.type !== "opaque" && !response.ok) {
    throw new Error(`El webhook respondió con estado ${response.status}.`);
  }

  return {
    ok: true,
    status: response.type === "opaque" ? "sent" : response.status,
    documentsCount: documents.filter((document) => document.received).length,
  };
}

import { REGISTRATION_DOCUMENTS } from "../constants/registrationDocuments";
import { getElementAssetsWorkflowUrl } from "../config/workflowEnv";
import { supabase } from "./auth/supabaseClient";
import { createRequestId } from "./supabaseBusiness/requestId";

const WORKFLOW_TIMEOUT_MS = 120000;

function normalizeNamePart(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildFolderName(elementData = {}) {
  return [
    elementData.apellidoPaterno,
    elementData.apellidoMaterno,
    elementData.nombre,
  ]
    .map(normalizeNamePart)
    .filter(Boolean)
    .join(" ")
    .toLocaleUpperCase("es-MX");
}

function getSelectedDocuments(files = {}) {
  return REGISTRATION_DOCUMENTS.flatMap((document) => {
    const file = files[document.key];
    if (!(file instanceof File)) return [];
    return [{ ...document, file, fieldName: `document_${document.type}` }];
  });
}

export async function provisionElementAssets({
  elementId,
  elementCode,
  elementData = {},
  files = {},
  requestId,
} = {}) {
  const normalizedElementId = normalizeNamePart(elementId);

  if (!normalizedElementId) {
    return {
      ok: false,
      code: "ELEMENT_ID_REQUIRED",
      message: "No se recibió el identificador del elemento.",
    };
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (sessionError || !accessToken) {
    return {
      ok: false,
      code: "SESSION_EXPIRED",
      message: "La carpeta y los documentos quedaron pendientes porque la sesión expiró.",
      raw: sessionError,
    };
  }

  const operationId = requestId || createRequestId();
  const selectedDocuments = getSelectedDocuments(files);
  const formData = new FormData();
  formData.set("contractVersion", "3.0");
  formData.set("action", "element.registration.assets");
  formData.set("requestId", operationId);
  formData.set("elementId", normalizedElementId);
  formData.set("elementCode", normalizeNamePart(elementCode));
  formData.set("folderName", buildFolderName(elementData));
  formData.set(
    "documents",
    JSON.stringify(
      selectedDocuments.map(({ type, label, file, fieldName }) => ({
        type,
        label,
        fieldName,
        originalFilename: file.name,
        sourceMimeType: file.type,
        sourceSizeBytes: file.size,
      }))
    )
  );
  selectedDocuments.forEach(({ file, fieldName }) => formData.append(fieldName, file));

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), WORKFLOW_TIMEOUT_MS);

  try {
    const response = await fetch(getElementAssetsWorkflowUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Idempotency-Key": operationId,
        "X-Request-Id": operationId,
      },
      body: formData,
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok || payload?.ok !== true) {
      return {
        ok: false,
        code: payload?.error?.code || `HTTP_${response.status}`,
        message:
          payload?.error?.message ||
          "La carpeta y los documentos quedaron pendientes.",
        raw: payload,
      };
    }

    return {
      ...payload,
      ok: true,
      requestId: payload.requestId || operationId,
      selectedDocuments: selectedDocuments.length,
    };
  } catch (error) {
    return {
      ok: false,
      code:
        error?.code === "WORKFLOW_CONFIG_ERROR"
          ? error.code
          : error?.name === "AbortError"
          ? "WORKFLOW_TIMEOUT"
          : "WORKFLOW_UNAVAILABLE",
      message:
        error?.code === "WORKFLOW_CONFIG_ERROR"
          ? "La automatización documental no está configurada."
          : "La carpeta y los documentos quedaron pendientes.",
      raw: error,
    };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

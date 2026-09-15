import { REGISTRATION_DOCUMENTS } from "../constants/registrationDocuments";
import { getElementAssetsWorkflowUrl } from "../config/workflowEnv";
import { supabase } from "./auth/supabaseClient";
import { executeSupabaseRpc } from "./supabaseBusiness/supabaseRpcClient";
import { createRequestId } from "./supabaseBusiness/requestId";

const WORKFLOW_TIMEOUT_MS = 120000;
const INTAKE_BUCKET =
  import.meta.env.VITE_SUPABASE_INTAKE_BUCKET || "element-intake";
const DOCUMENTS_BUCKET =
  import.meta.env.VITE_SUPABASE_DOCUMENTS_BUCKET || "element-documents";
const MAX_BACKGROUND_JOBS_PER_RUN = 3;
export const ELEMENT_ASSET_JOB_EVENT = "pdmu:element-asset-job-queued";

let workerPromise = null;
let workerRerunRequested = false;

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

function safeFileName(fileName) {
  const normalized = String(fileName || "documento")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "documento";
}

function getDocumentByType(type) {
  return REGISTRATION_DOCUMENTS.find((document) => document.type === type);
}

async function removeStagedDocuments(documents = []) {
  const paths = documents
    .map((document) => document?.storagePath)
    .filter(Boolean);
  if (paths.length === 0) return;
  await supabase.storage.from(INTAKE_BUCKET).remove(paths);
}

export async function stageElementDocuments({
  elementId,
  requestId,
  files = {},
} = {}) {
  const selectedDocuments = getSelectedDocuments(files);
  if (selectedDocuments.length === 0) {
    return { ok: true, documents: [] };
  }

  const uploaded = [];
  const results = await Promise.all(
    selectedDocuments.map(async ({ file, key, type, label, fieldName }) => {
      const objectPath = `${elementId}/${requestId}/${type}-${safeFileName(file.name)}`;
      const { error } = await supabase.storage
        .from(INTAKE_BUCKET)
        .upload(objectPath, file, {
          contentType: file.type,
          upsert: true,
        });

      if (error) return { ok: false, error };

      const document = {
        key,
        type,
        label,
        fieldName,
        storagePath: objectPath,
        originalFilename: file.name,
        sourceMimeType: file.type,
        sourceSizeBytes: file.size,
      };
      uploaded.push(document);
      return { ok: true, document };
    })
  );

  const failed = results.find((result) => !result.ok);
  if (failed) {
    await removeStagedDocuments(uploaded);
    return {
      ok: false,
      code: failed.error?.name || "INTAKE_UPLOAD_FAILED",
      message: "No se pudieron preparar los documentos. Intenta nuevamente.",
      raw: failed.error,
    };
  }

  return {
    ok: true,
    documents: results.map((result) => result.document),
  };
}

export async function queueElementAssetJob({
  requestId,
  elementId,
  documents = [],
} = {}) {
  const result = await executeSupabaseRpc("queue_element_assets", {
    p_request_id: requestId,
    p_element_id: elementId,
    p_documents: documents,
  });

  if (!result.ok) {
    await removeStagedDocuments(documents);
    return result;
  }

  return {
    ...result,
    job: result.data?.job,
  };
}

export async function provisionElementAssets({
  elementId,
  elementCode,
  elementData = {},
  files = {},
  requestId,
  folderName,
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
  formData.set("folderName", folderName || buildFolderName(elementData));
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

export async function removeElementDocumentAsset({
  elementId,
  document,
  requestId,
} = {}) {
  const normalizedElementId = normalizeNamePart(elementId);
  const documentId = normalizeNamePart(document?.documentId);
  const storageObjectPath = normalizeNamePart(document?.storageObjectPath);

  if (!normalizedElementId || !documentId) {
    return {
      ok: false,
      code: "DOCUMENT_REQUIRED",
      message: "No se recibió un documento válido.",
    };
  }

  if (storageObjectPath) {
    const { error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .remove([storageObjectPath]);
    if (error) {
      return {
        ok: false,
        code: error.name || "DOCUMENT_DELETE_FAILED",
        message: "No se pudo eliminar el archivo almacenado.",
        raw: error,
      };
    }
    return { ok: true, requestId };
  }

  const fileId = normalizeNamePart(document?.driveFileId);
  if (!fileId) {
    return {
      ok: false,
      code: "DOCUMENT_FILE_ID_REQUIRED",
      message: "El documento no tiene una referencia de archivo válida.",
    };
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (sessionError || !accessToken) {
    return {
      ok: false,
      code: "SESSION_EXPIRED",
      message: "Tu sesión expiró. Inicia sesión nuevamente.",
      raw: sessionError,
    };
  }

  const operationId = requestId || createRequestId();
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), WORKFLOW_TIMEOUT_MS);

  try {
    const response = await fetch(getElementAssetsWorkflowUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": operationId,
        "X-Request-Id": operationId,
      },
      body: JSON.stringify({
        contractVersion: "3.1",
        action: "element.document.delete",
        requestId: operationId,
        elementId: normalizedElementId,
        documentId,
        fileId,
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || payload?.ok !== true) {
      return {
        ok: false,
        code: payload?.error?.code || `HTTP_${response.status}`,
        message: payload?.error?.message || "No se pudo eliminar el archivo en Drive.",
        raw: payload,
      };
    }

    return { ok: true, requestId: payload.requestId || operationId, raw: payload };
  } catch (error) {
    return {
      ok: false,
      code: error?.name === "AbortError" ? "WORKFLOW_TIMEOUT" : "WORKFLOW_UNAVAILABLE",
      message: "No se pudo eliminar el archivo en Drive.",
      raw: error,
    };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function loadStagedFiles(documents = []) {
  const files = {};

  for (const document of documents) {
    const definition = getDocumentByType(document.type);
    if (!definition || !document.storagePath) continue;

    const { data, error } = await supabase.storage
      .from(INTAKE_BUCKET)
      .download(document.storagePath);

    if (error || !data) {
      throw Object.assign(new Error("No se pudo recuperar un documento temporal."), {
        code: error?.name || "INTAKE_DOWNLOAD_FAILED",
      });
    }

    files[definition.key] = new File(
      [data],
      document.originalFilename || `${document.type}.pdf`,
      { type: document.sourceMimeType || data.type || "application/octet-stream" }
    );
  }

  return files;
}

async function failElementAssetJob(requestId, error) {
  return executeSupabaseRpc("fail_element_asset_job", {
    p_request_id: requestId,
    p_error_code: error?.code || "ASSET_PROCESSING_FAILED",
    p_error_message:
      error?.message || "No se pudo completar el procesamiento documental.",
  });
}

async function processClaimedJob(job) {
  try {
    const files = await loadStagedFiles(job.documents);
    const assets = await provisionElementAssets({
      elementId: job.elementId,
      elementCode: job.elementCode,
      files,
      requestId: job.requestId,
      folderName: job.folderName,
    });

    if (!assets.ok) {
      await failElementAssetJob(job.requestId, assets);
      return false;
    }

    const driveFolder = assets?.data?.driveFolder ?? assets?.driveFolder;
    const qr = assets?.data?.qr ?? assets?.qr;
    const documents = assets?.data?.documents ?? assets?.documents ?? [];
    const completion = await executeSupabaseRpc("complete_element_assets", {
      p_request_id: job.requestId,
      p_element_id: job.elementId,
      p_drive_folder_id: driveFolder?.id,
      p_drive_folder_url: driveFolder?.url,
      p_qr_value: qr?.value || `pdmu:element:${job.elementId}`,
      p_documents: Array.isArray(documents) ? documents : [],
    });

    if (!completion.ok) {
      await failElementAssetJob(job.requestId, completion);
      return false;
    }

    await removeStagedDocuments(job.documents);
    return true;
  } catch (error) {
    await failElementAssetJob(job.requestId, error);
    return false;
  }
}

async function runWorker() {
  for (let index = 0; index < MAX_BACKGROUND_JOBS_PER_RUN; index += 1) {
    const claimed = await executeSupabaseRpc("claim_next_element_asset_job");
    if (!claimed.ok || !claimed.data?.job) break;
    await processClaimedJob(claimed.data.job);
  }
}

export function processPendingElementAssetJobs() {
  if (workerPromise) {
    workerRerunRequested = true;
    return workerPromise;
  }

  workerPromise = runWorker()
    .catch((error) => {
      console.error("No se pudo ejecutar la cola documental:", error);
    })
    .finally(() => {
      workerPromise = null;
      if (workerRerunRequested) {
        workerRerunRequested = false;
        processPendingElementAssetJobs();
      }
    });

  return workerPromise;
}

export function requestElementAssetProcessing() {
  globalThis.dispatchEvent?.(new Event(ELEMENT_ASSET_JOB_EVENT));
}

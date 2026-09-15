import {
  cancelElementDocumentSupabase,
  createElementSupabase,
  deactivateElementSupabase,
  getElementSupabase,
  listElementsSupabase,
  searchElementsSupabase,
  setElementSelfTutorSupabase,
  updateElementFieldSupabase,
} from "./supabaseBusiness/elementsRepository";
import { REGISTRATION_DOCUMENTS } from "../constants/registrationDocuments";
import {
  queueElementAssetJob,
  removeElementDocumentAsset,
  requestElementAssetProcessing,
  stageElementDocuments,
} from "./elementAssetsService";
import { createRequestId } from "./supabaseBusiness/requestId";

const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

export function searchElements(options = {}) {
  return searchElementsSupabase(options);
}

export function listElements(options = {}) {
  return listElementsSupabase(options);
}

export function getElement(options = {}) {
  return getElementSupabase(options);
}

export async function registerElement(elementData, files = {}) {
  const result = await createElementSupabase(elementData);
  if (!result.ok) return result;

  const selectedDocuments = REGISTRATION_DOCUMENTS.filter(
    ({ key }) => files[key] instanceof File
  );
  const staged = await stageElementDocuments({
    elementId: result.data.elementId,
    files,
    requestId: elementData.assetsRequestId,
  });

  if (!staged.ok) {
    return {
      ...result,
      documents: {
        selected: selectedDocuments.length,
        staged: 0,
        pending: selectedDocuments.length,
      },
      assets: staged,
      registrationStatus: "pending_assets",
      message: `El expediente quedó guardado. ${staged.message}`,
    };
  }

  const queued = await queueElementAssetJob({
    requestId: elementData.assetsRequestId,
    elementId: result.data.elementId,
    documents: staged.documents,
  });

  const baseMessage = result.data?.reactivated
    ? "La inscripción quedó reactivada."
    : "El expediente quedó guardado.";

  if (!queued.ok) {
    return {
      ...result,
      documents: {
        selected: selectedDocuments.length,
        staged: 0,
        pending: selectedDocuments.length,
      },
      assets: queued,
      registrationStatus: "pending_assets",
      message: `${baseMessage} No se pudo programar la documentación; intenta nuevamente.`,
    };
  }

  requestElementAssetProcessing();

  return {
    ...result,
    documents: {
      selected: selectedDocuments.length,
      staged: staged.documents.length,
      pending: selectedDocuments.length,
    },
    assets: queued,
    registrationStatus: "processing",
    message: `${baseMessage} La documentación se procesará en segundo plano.`,
  };
}

export function deactivateElement(options = {}) {
  return deactivateElementSupabase(options);
}

export function updateElementField(options = {}) {
  return updateElementFieldSupabase(options);
}

export function setElementSelfTutor(options = {}) {
  return setElementSelfTutorSupabase(options);
}

export async function uploadElementDocument({ elementId, documentType, file } = {}) {
  const documentDefinition = REGISTRATION_DOCUMENTS.find(
    (document) => document.type === documentType
  );
  if (!elementId || !documentDefinition) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Selecciona un documento válido." };
  }
  if (!(file instanceof File)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Selecciona una foto o un PDF." };
  }
  if (file.type !== "application/pdf" && !file.type.startsWith("image/")) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Selecciona una foto o un PDF." };
  }
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    return { ok: false, code: "VALIDATION_ERROR", message: "El documento no debe superar 10 MB." };
  }

  const requestId = createRequestId();
  const staged = await stageElementDocuments({
    elementId,
    requestId,
    files: { [documentDefinition.key]: file },
  });
  if (!staged.ok) return staged;

  const queued = await queueElementAssetJob({
    requestId,
    elementId,
    documents: staged.documents,
  });
  if (!queued.ok) return queued;

  requestElementAssetProcessing();
  const refreshed = await getElementSupabase({
    elementId,
    include: ["profile", "documents"],
  });

  return {
    ...(refreshed.ok ? refreshed : queued),
    ok: true,
    requestId,
    message: file.type.startsWith("image/")
      ? "Foto recibida. Se convertirá a PDF y se agregará al expediente."
      : "PDF recibido. Se agregará al expediente en segundo plano.",
  };
}

export async function removeElementDocument({ elementId, document } = {}) {
  if (!elementId || !document?.documentId) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Selecciona un documento válido." };
  }

  const requestId = createRequestId();
  const assetResult = await removeElementDocumentAsset({
    elementId,
    document,
    requestId,
  });
  if (!assetResult.ok) return assetResult;

  return cancelElementDocumentSupabase({
    elementId,
    documentId: document.documentId,
  });
}

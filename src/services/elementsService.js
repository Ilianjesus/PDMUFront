import {
  completeElementAssetsSupabase,
  createElementSupabase,
  deactivateElementSupabase,
  getElementSupabase,
  listElementsSupabase,
  searchElementsSupabase,
  setElementSelfTutorSupabase,
  updateElementFieldSupabase,
  uploadElementDocumentSupabase,
} from "./supabaseBusiness/elementsRepository";
import { REGISTRATION_DOCUMENTS } from "../constants/registrationDocuments";
import { provisionElementAssets } from "./elementAssetsService";

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
  const assets = await provisionElementAssets({
    elementId: result.data.elementId,
    elementCode: result.data.elementCode,
    elementData,
    files,
    requestId: elementData.assetsRequestId,
  });

  const persistedAssets = assets.ok
    ? await completeElementAssetsSupabase({
        requestId: assets.requestId,
        elementId: result.data.elementId,
        assets,
      })
    : assets;
  const uploadedDocuments = assets.ok
    ? assets.data?.documents?.length ?? assets.documents?.length ?? 0
    : 0;

  const baseMessage = result.data?.reactivated
    ? "La inscripción se reactivó correctamente."
    : "La inscripción se guardó correctamente.";

  return {
    ...result,
    documents: {
      selected: selectedDocuments.length,
      uploaded: uploadedDocuments,
      pending: Math.max(selectedDocuments.length - uploadedDocuments, 0),
    },
    assets: persistedAssets,
    message:
      [
        baseMessage,
        !assets.ok || !persistedAssets.ok
          ? "La carpeta o algunos documentos quedaron pendientes y pueden completarse desde el expediente."
          : selectedDocuments.length > 0
            ? "Los documentos se cargaron correctamente."
            : "",
        assets.ok && persistedAssets.ok
          ? "La carpeta y el código QR están listos."
          : assets.message || persistedAssets.message,
      ]
        .filter(Boolean)
        .join(" "),
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

export function uploadElementDocument(options = {}) {
  return uploadElementDocumentSupabase(options);
}

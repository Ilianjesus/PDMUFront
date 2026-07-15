import {
  createElementSupabase,
  deactivateElementSupabase,
  getElementSupabase,
  listElementsSupabase,
  searchElementsSupabase,
} from "./supabaseBusiness/elementsRepository";
import {
  submitRegistrationWebhook,
} from "./registrationWebhookService";

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

  try {
    const webhook = await submitRegistrationWebhook({
      elementData,
      files,
      supabaseElement: result.data,
      requestId: result.requestId,
    });

    return {
      ...result,
      webhook,
      message: result.data?.reactivated
        ? "La inscripción se reactivó y los documentos se enviaron correctamente."
        : "La inscripción se guardó y los documentos se enviaron correctamente.",
    };
  } catch (error) {
    console.error("Error enviando documentos al webhook:", error);
    return {
      ...result,
      webhook: {
        ok: false,
        message: error?.message || "No se pudieron enviar los documentos.",
      },
      message:
        "La inscripción se guardó correctamente, pero los documentos no pudieron enviarse. Intenta enviarlos nuevamente más tarde.",
    };
  }
}

export function deactivateElement(options = {}) {
  return deactivateElementSupabase(options);
}

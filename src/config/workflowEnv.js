export class WorkflowConfigError extends Error {
  constructor(variableName) {
    super(`Falta configurar ${variableName} con una URL HTTPS válida.`);
    this.name = "WorkflowConfigError";
    this.code = "WORKFLOW_CONFIG_ERROR";
  }
}

function readHttpsUrl(variableName, value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch {
    throw new WorkflowConfigError(variableName);
  }
}

export function getElementAssetsWorkflowUrl() {
  return readHttpsUrl(
    "VITE_N8N_ELEMENTS_ASSETS_URL",
    import.meta.env.VITE_N8N_ELEMENTS_ASSETS_URL
  );
}

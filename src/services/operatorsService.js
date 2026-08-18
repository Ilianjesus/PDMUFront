import { getOperatorsWorkflowUrl } from "../config/workflowEnv";
import { supabase } from "./auth/supabaseClient";

const WORKFLOW_TIMEOUT_MS = 15000;

function normalizeOperator(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || row.email,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listOperators() {
  const { data, error } = await supabase
    .from("operator_profiles")
    .select("id,email,display_name,role,status,created_at,updated_at")
    .order("display_name", { ascending: true, nullsFirst: false })
    .order("email", { ascending: true });

  if (error) {
    return {
      ok: false,
      code: error.code || "OPERATORS_QUERY_ERROR",
      message: "No se pudo cargar la lista de operadores.",
      raw: error,
    };
  }

  return {
    ok: true,
    data: Array.isArray(data) ? data.map(normalizeOperator) : [],
  };
}

async function callOperatorsWorkflow(action, data) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (sessionError || !accessToken) {
    return {
      ok: false,
      code: "SESSION_EXPIRED",
      message: "Tu sesión expiró. Inicia sesión nuevamente.",
    };
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), WORKFLOW_TIMEOUT_MS);
  let response;

  try {
    response = await fetch(getOperatorsWorkflowUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Request-Id": crypto.randomUUID(),
      },
      body: JSON.stringify({
        contractVersion: "1.0",
        action,
        data,
      }),
      signal: controller.signal,
    });
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
          ? "La gestión de operadores no está configurada."
          : error?.name === "AbortError"
          ? "La operación tardó demasiado. Intenta nuevamente."
          : "No se pudo conectar con la gestión de operadores.",
      raw: error,
    };
  } finally {
    window.clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) {
    return {
      ok: false,
      code: payload?.error?.code || `HTTP_${response.status}`,
      message: payload?.error?.message || "No se pudo completar la operación de operadores.",
      raw: payload,
    };
  }

  return payload;
}

export function inviteOperator(input) {
  return callOperatorsWorkflow("operator.invite", input);
}

export function updateOperator(input) {
  return callOperatorsWorkflow("operator.update", input);
}

import { supabase } from "./auth/supabaseClient";

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

async function callOperatorsFunction(action, data) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (sessionError || !accessToken) {
    return {
      ok: false,
      code: "SESSION_EXPIRED",
      message: "Tu sesión expiró. Inicia sesión nuevamente.",
    };
  }

  try {
    const { data: payload, error } = await supabase.functions.invoke("manage-operators", {
      body: { action, data },
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (error) {
      const failure = payload?.error || await error.context?.json?.().catch(() => null);
      return {
        ok: false,
        code: failure?.error?.code || failure?.code || "OPERATOR_FUNCTION_ERROR",
        message: failure?.error?.message || failure?.message ||
          "No se pudo completar la operación de operadores.",
        raw: error,
      };
    }
    if (payload?.ok !== true) {
      return {
        ok: false,
        code: payload?.error?.code || "OPERATOR_FUNCTION_ERROR",
        message: payload?.error?.message || "No se pudo completar la operación de operadores.",
        raw: payload,
      };
    }
    return payload;
  } catch (error) {
    return {
      ok: false,
      code: "OPERATOR_FUNCTION_UNAVAILABLE",
      message: "No se pudo conectar con la gestión de operadores.",
      raw: error,
    };
  }
}

export function inviteOperator(input) {
  return callOperatorsFunction("operator.invite", input);
}

export function updateOperator(input) {
  return callOperatorsFunction("operator.update", input);
}

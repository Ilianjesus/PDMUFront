import { supabase } from "./auth/supabaseClient";

export async function getCurrentOperatorProfile(userId) {
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
  if (!normalizedUserId) {
    return {
      ok: false,
      code: "INVALID_USER_ID",
      message: "No se pudo identificar la cuenta de operador.",
    };
  }

  const { data, error } = await supabase
    .from("operator_profiles")
    .select("id,email,display_name,role,status,created_at,updated_at")
    .eq("id", normalizedUserId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      code: error.code || "OPERATOR_PROFILE_ERROR",
      message: "No se pudo validar el perfil de operador.",
      raw: error,
    };
  }

  if (!data) {
    return {
      ok: false,
      code: "OPERATOR_PROFILE_MISSING",
      message: "La cuenta no tiene un perfil de operador autorizado.",
    };
  }

  return {
    ok: true,
    data: {
      id: data.id,
      email: data.email,
      displayName: data.display_name || data.email,
      role: data.role,
      status: data.status,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  };
}

import { supabase } from "../auth/supabaseClient";

const ERROR_MESSAGES = Object.freeze({
  ACTIVE_OPERATOR_REQUIRED:
    "Tu cuenta no tiene un perfil de operador activo. Solicita el alta o la reactivación a un administrador.",
  ADMIN_OPERATOR_REQUIRED:
    "Tu perfil no tiene permisos suficientes para realizar esta operación.",
  ELEMENT_NOT_FOUND: "No se encontró el elemento solicitado.",
  ELEMENT_ALREADY_EXISTS: "Ya existe un elemento con esos datos.",
  ACTIVE_ENROLLMENT_REQUIRED:
    "El elemento no tiene una inscripción activa.",
  INVALID_PAYMENT_PERIOD: "El periodo de pago no es válido.",
  PAYMENT_METHOD_NOT_ALLOWED: "El método de pago no está permitido.",
  PAYMENT_POLICY_UNAVAILABLE:
    "No hay tarifa activa configurada para esa mensualidad.",
  PERIOD_ALREADY_PAID: "Esa mensualidad ya está registrada como pagada.",
  PAYMENT_NOT_FOUND: "No se encontró el pago solicitado.",
  PAYMENT_CANCELLED: "Ese pago ya estaba cancelado.",
  CANCEL_REASON_REQUIRED: "Captura un motivo para cancelar el registro.",
  VERSION_CONFLICT:
    "El registro cambió en Supabase. Recarga el historial e inténtalo otra vez.",
  INVALID_ATTENDANCE_STATUS: "El estado de asistencia no es válido.",
  INVALID_ATTENDANCE_SOURCE: "El origen de asistencia no es válido.",
  INVALID_ATTENDANCE_RANGE: "El rango de asistencias no es válido.",
  REQUIRED_ACTIVITY_FIELDS_MISSING: "Captura el nombre de la actividad.",
  INVALID_ACTIVITY_CATEGORY: "La categoría de actividad no es válida.",
  INVALID_ACTIVITY_STATUS: "El estado de actividad no es válido.",
  ACTIVITY_NOT_FOUND: "No se encontró la actividad solicitada.",
  ACTIVITY_INACTIVE: "La actividad está inactiva.",
  INVALID_SESSION_DATE: "La fecha de sesión no es válida.",
  INVALID_ATTENDANCE_SCOPE: "La regla de asistencia no es válida.",
  INVALID_SESSION_STATUS: "El estado de sesión no es válido.",
  SESSION_NOT_FOUND: "No se encontró la sesión solicitada.",
  SESSION_NOT_OPEN: "La sesión no está abierta para registrar asistencia.",
  ATTENDANCE_ALREADY_RECORDED:
    "Ese elemento ya tiene asistencia registrada para esta sesión.",
  ATTENDANCE_NOT_FOUND: "No se encontró la asistencia solicitada.",
  ATTENDANCE_CANCELLED: "Esa asistencia ya estaba cancelada.",
  QUERY_TOO_SHORT: "Ingresa al menos dos caracteres para buscar.",
  INVALID_ELEMENT_STATUS: "El estado solicitado no es válido.",
  REQUIRED_ELEMENT_FIELDS_MISSING: "Completa todos los datos obligatorios del elemento.",
  INVALID_BIRTH_DATE: "La fecha de nacimiento no es válida.",
  INVALID_ENROLLMENT_DATE: "La fecha de inscripción no es válida.",
  INVALID_BILLING_POLICY: "La política de cobro no es válida.",
  INVALID_GUARDIAN_PHONE: "El teléfono del tutor no es válido.",
  PAYMENT_PERIOD_NOT_APPLICABLE:
    "Esa mensualidad no aplica para el elemento por su fecha de inscripción.",
  INVALID_STATISTICS_RANGE: "El periodo de estadísticas no es válido.",
});

function extractBusinessCode(error) {
  const errorText = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  return Object.keys(ERROR_MESSAGES).find((code) => errorText.includes(code)) ?? null;
}

function isExpiredSessionError(error) {
  const errorText = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    error?.code === "PGRST301" ||
    error?.code === "PGRST303" ||
    errorText.includes("jwt expired") ||
    errorText.includes("invalid jwt")
  );
}

function normalizeRpcError(error) {
  if (isExpiredSessionError(error)) {
    return {
      ok: false,
      code: "SESSION_EXPIRED",
      message: "Tu sesión expiró. Inicia sesión nuevamente.",
      raw: error,
    };
  }

  const businessCode = extractBusinessCode(error);
  if (businessCode) {
    return {
      ok: false,
      code:
        businessCode === "ELEMENT_ALREADY_EXISTS"
          ? "ALREADY_EXISTS"
          : businessCode,
      message: ERROR_MESSAGES[businessCode],
      raw: error,
    };
  }

  if (error?.code === "23505") {
    return {
      ok: false,
      code: "ALREADY_EXISTS",
      message: "Ya existe un elemento con esos datos.",
      raw: error,
    };
  }

  if (error?.code === "42501") {
    return {
      ok: false,
      code: "INSUFFICIENT_PERMISSIONS",
      message: "No tienes permisos para realizar esta operación.",
      raw: error,
    };
  }

  if (error?.code === "22023") {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Los datos enviados no son válidos.",
      raw: error,
    };
  }

  return {
    ok: false,
    code: error?.code || "SUPABASE_RPC_ERROR",
    message: "No se pudo completar la operación en Supabase.",
    raw: error,
  };
}

export async function executeSupabaseRpc(functionName, params = {}) {
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError || !sessionData.session?.access_token) {
    return {
      ok: false,
      code: "SESSION_EXPIRED",
      message: "Tu sesión expiró. Inicia sesión nuevamente.",
      raw: sessionError,
    };
  }

  const { data, error } = await supabase.rpc(functionName, params);

  if (error) return normalizeRpcError(error);

  if (!data || typeof data !== "object" || data.ok !== true) {
    return {
      ok: false,
      code: "INVALID_RESPONSE",
      message: "Supabase devolvió una respuesta inesperada.",
      raw: data,
    };
  }

  return {
    ok: true,
    data,
    raw: data,
    integration: "supabase-business",
  };
}

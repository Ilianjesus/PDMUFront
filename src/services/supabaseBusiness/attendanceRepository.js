import { searchElementsSupabase } from "./elementsRepository";
import { executeSupabaseRpc } from "./supabaseRpcClient";
import {
  mapActivitySessionsResponse,
  mapAttendanceActivity,
  mapAttendanceCreated,
  mapAttendanceActivitiesResponse,
  mapAttendanceException,
  mapAttendanceListResponse,
  mapAttendanceStatementResponse,
  mapAttendanceStatus,
} from "./mappers";
import { createRequestId } from "./requestId";

function validationError(message, fieldErrors = {}) {
  return {
    ok: false,
    code: "VALIDATION_ERROR",
    message,
    fieldErrors,
    raw: null,
  };
}

function invalidResponse(message, raw) {
  return {
    ok: false,
    code: "INVALID_RESPONSE",
    message,
    raw,
  };
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function looksLikeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function extractIdentifier(value) {
  const normalized = normalizeText(value);
  if (!normalized) return "";

  try {
    const parsed = JSON.parse(normalized);
    if (parsed && typeof parsed === "object") {
      return normalizeText(
        parsed.elementId ?? parsed.element_id ?? parsed.ID ?? parsed.id ?? parsed.elementCode
      );
    }
  } catch {
    // El QR también puede ser texto plano; en ese caso usamos el valor original.
  }

  return normalized;
}

async function resolveElementId(identifier) {
  const normalized = extractIdentifier(identifier);
  if (!normalized) return validationError("Captura o selecciona un elemento válido.");
  if (looksLikeUuid(normalized)) {
    return { ok: true, elementId: normalized, matchedElement: null };
  }

  const searchResult = await searchElementsSupabase({
    query: normalized,
    limit: 5,
    cursor: null,
  });
  if (!searchResult.ok) return searchResult;

  const exactMatches = searchResult.data.filter((item) => {
    const candidates = [
      item.ID,
      item.elementCode,
      item.displayName,
      item.Nombre,
    ].map((candidate) => normalizeText(candidate).toLowerCase());
    return candidates.includes(normalized.toLowerCase());
  });
  const match = exactMatches[0] ?? (searchResult.data.length === 1 ? searchResult.data[0] : null);

  if (!match?.ID) {
    return validationError(
      "No se pudo resolver ese identificador. Busca y selecciona el elemento para evitar ambigüedades."
    );
  }

  return {
    ok: true,
    elementId: match.ID,
    matchedElement: match,
  };
}

export async function recordAttendanceSupabase({
  elementId,
  identifier,
  sessionId,
  status = "present",
  source = "manual",
  requestId = null,
} = {}) {
  const resolved = await resolveElementId(elementId ?? identifier);
  if (!resolved.ok) return resolved;

  const normalizedStatus = mapAttendanceStatus(status);
  const normalizedSource = normalizeText(source).toLowerCase() || "manual";
  const normalizedSessionId = normalizeText(sessionId);
  if (!["present", "absent", "late", "excused"].includes(normalizedStatus)) {
    return validationError("Selecciona un estado de asistencia válido.");
  }
  if (!["manual", "qr"].includes(normalizedSource)) {
    return validationError("El origen de asistencia no es válido.");
  }

  let operationId;
  try {
    operationId = requestId || createRequestId();
  } catch (error) {
    return {
      ok: false,
      code: "REQUEST_ID_UNAVAILABLE",
      message: error.message,
      raw: error,
    };
  }

  const result = await executeSupabaseRpc("record_attendance", {
    p_request_id: operationId,
    p_element_id: resolved.elementId,
    p_status: normalizedStatus,
    p_source: normalizedSource,
    p_session_id: normalizedSessionId || null,
  });
  if (!result.ok) return result;

  const attendance = mapAttendanceCreated(result.data);
  if (!attendance) {
    return invalidResponse("Supabase no confirmó la asistencia registrada.", result.raw);
  }

  return {
    ...result,
    data: {
      ...attendance,
      matchedElement: resolved.matchedElement,
    },
    requestId: operationId,
    message: "Asistencia registrada correctamente en Supabase.",
  };
}

export async function listAttendanceActivitiesSupabase({
  includeInactive = false,
} = {}) {
  const result = await executeSupabaseRpc("list_attendance_activities", {
    p_include_inactive: Boolean(includeInactive),
  });
  if (!result.ok) return result;

  return {
    ...result,
    data: mapAttendanceActivitiesResponse(result.data),
  };
}

export async function upsertAttendanceActivitySupabase({
  name,
  category = "activity",
  description = "",
} = {}) {
  const normalizedName = normalizeText(name);
  const normalizedCategory = normalizeText(category) || "activity";

  if (!normalizedName) return validationError("Captura el nombre de la actividad.");
  if (!["mandatory", "activity", "event"].includes(normalizedCategory)) {
    return validationError("Selecciona una categoría válida.");
  }

  const result = await executeSupabaseRpc("upsert_attendance_activity", {
    p_name: normalizedName,
    p_category: normalizedCategory,
    p_description: normalizeText(description) || null,
  });
  if (!result.ok) return result;

  return {
    ...result,
    data: mapAttendanceActivity(result.data.activity),
    message: "Actividad guardada correctamente.",
  };
}

export async function setAttendanceActivityStatusSupabase({
  activityId,
  status,
} = {}) {
  const normalizedActivityId = normalizeText(activityId);
  const normalizedStatus = normalizeText(status);

  if (!normalizedActivityId) return validationError("Selecciona una actividad válida.");
  if (!["active", "inactive"].includes(normalizedStatus)) {
    return validationError("Selecciona un estado válido.");
  }

  const result = await executeSupabaseRpc("set_attendance_activity_status", {
    p_activity_id: normalizedActivityId,
    p_status: normalizedStatus,
  });
  if (!result.ok) return result;

  return {
    ...result,
    data: mapAttendanceActivity(result.data.activity),
    message:
      normalizedStatus === "active"
        ? "Actividad activada correctamente."
        : "Actividad desactivada correctamente.",
  };
}

export async function listActivitySessionsSupabase({
  from = null,
  to = null,
  includeInactive = false,
} = {}) {
  const result = await executeSupabaseRpc("list_activity_sessions", {
    p_from: from || null,
    p_to: to || null,
    p_include_inactive: Boolean(includeInactive),
  });
  if (!result.ok) return result;

  return {
    ...result,
    data: mapActivitySessionsResponse(result.data),
  };
}

export async function createActivitySessionSupabase({
  activityId,
  sessionDate,
  startsAt = null,
  endsAt = null,
  location = "",
  attendanceScope = "open",
  attendanceRequired = false,
  status = "scheduled",
} = {}) {
  const normalizedActivityId = normalizeText(activityId);
  const normalizedDate = normalizeText(sessionDate);
  const normalizedScope = normalizeText(attendanceScope) || "open";
  const normalizedStatus = normalizeText(status) || "scheduled";

  if (!normalizedActivityId) return validationError("Selecciona una actividad válida.");
  if (!normalizedDate) return validationError("Selecciona una fecha de sesión.");
  if (!["all_active", "enrolled", "open"].includes(normalizedScope)) {
    return validationError("Selecciona una regla de asistencia válida.");
  }
  if (!["scheduled", "open", "closed", "cancelled"].includes(normalizedStatus)) {
    return validationError("Selecciona un estado de sesión válido.");
  }

  const result = await executeSupabaseRpc("create_activity_session", {
    p_activity_id: normalizedActivityId,
    p_session_date: normalizedDate,
    p_starts_at: normalizeText(startsAt) || null,
    p_ends_at: normalizeText(endsAt) || null,
    p_location: normalizeText(location) || null,
    p_attendance_scope: normalizedScope,
    p_attendance_required: Boolean(attendanceRequired),
    p_status: normalizedStatus,
  });
  if (!result.ok) return result;

  return {
    ...result,
    message: "Sesión creada correctamente.",
  };
}

export async function getAttendanceStatementSupabase({
  elementId,
  from = null,
  to = null,
  elementName = "",
} = {}) {
  const normalizedElementId = normalizeText(elementId);
  if (!normalizedElementId) return validationError("Selecciona un elemento válido.");

  const result = await executeSupabaseRpc("get_element_attendance_statement", {
    p_element_id: normalizedElementId,
    p_from: from || null,
    p_to: to || null,
  });
  if (!result.ok) return result;

  return {
    ...result,
    data: mapAttendanceStatementResponse(result.data, {
      elementId: normalizedElementId,
      elementName,
    }),
  };
}

export async function createAttendanceExceptionSupabase({
  elementId,
  scope = "weekday",
  weekday = null,
  sessionId = null,
  startsOn = null,
  endsOn = null,
  reason = "",
} = {}) {
  const normalizedElementId = normalizeText(elementId);
  const normalizedScope = normalizeText(scope) || "weekday";
  const normalizedReason = normalizeText(reason);
  const normalizedWeekday = weekday === null || weekday === "" ? null : Number(weekday);

  if (!normalizedElementId) return validationError("Selecciona un elemento válido.");
  if (!["weekday", "date_range", "session"].includes(normalizedScope)) {
    return validationError("Selecciona un tipo de exención válido.");
  }
  if (normalizedScope === "weekday" && !Number.isInteger(normalizedWeekday)) {
    return validationError("Selecciona un día obligatorio válido.");
  }
  if (!normalizedReason) return validationError("Captura el motivo de la exención.");

  const result = await executeSupabaseRpc("create_attendance_exception", {
    p_element_id: normalizedElementId,
    p_scope: normalizedScope,
    p_reason: normalizedReason,
    p_weekday: normalizedWeekday,
    p_session_id: normalizeText(sessionId) || null,
    p_starts_on: startsOn || null,
    p_ends_on: endsOn || null,
  });
  if (!result.ok) return result;

  return {
    ...result,
    data: mapAttendanceException(result.data.exception),
    message: "Exención registrada correctamente.",
  };
}

export async function listAttendanceSupabase({
  elementId,
  from = null,
  to = null,
  limit = 100,
  elementName = "",
} = {}) {
  const normalizedElementId = normalizeText(elementId);
  if (!normalizedElementId) return validationError("Selecciona un elemento válido.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return validationError("El límite debe ser un entero entre 1 y 200.");
  }

  const result = await executeSupabaseRpc("list_attendance", {
    p_element_id: normalizedElementId,
    p_from: from || null,
    p_to: to || null,
    p_limit: limit,
  });
  if (!result.ok) return result;

  const data = mapAttendanceListResponse(result.data, {
    elementId: normalizedElementId,
    elementName,
  });

  return {
    ...result,
    data,
  };
}

export async function cancelAttendanceSupabase({
  attendanceId,
  expectedVersion,
  reason,
  requestId = null,
} = {}) {
  const normalizedAttendanceId = normalizeText(attendanceId);
  const normalizedVersion = Number(expectedVersion);
  const normalizedReason = normalizeText(reason);

  if (!normalizedAttendanceId) return validationError("Selecciona una asistencia válida.");
  if (!Number.isInteger(normalizedVersion)) {
    return validationError("Recarga la asistencia antes de cancelarla.");
  }
  if (!normalizedReason) return validationError("Captura un motivo de cancelación.");

  let operationId;
  try {
    operationId = requestId || createRequestId();
  } catch (error) {
    return {
      ok: false,
      code: "REQUEST_ID_UNAVAILABLE",
      message: error.message,
      raw: error,
    };
  }

  const result = await executeSupabaseRpc("cancel_attendance", {
    p_request_id: operationId,
    p_attendance_id: normalizedAttendanceId,
    p_expected_version: normalizedVersion,
    p_reason: normalizedReason,
  });
  if (!result.ok) return result;

  return {
    ...result,
    requestId: operationId,
    message: "Asistencia cancelada correctamente en Supabase.",
  };
}

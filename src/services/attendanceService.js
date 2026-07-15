import {
  cancelAttendanceSupabase,
  createActivitySessionSupabase,
  createAttendanceExceptionSupabase,
  getAttendanceStatementSupabase,
  listActivitySessionsSupabase,
  listAttendanceActivitiesSupabase,
  listAttendanceSupabase,
  recordAttendanceSupabase,
  setAttendanceActivityStatusSupabase,
  upsertAttendanceActivitySupabase,
} from "./supabaseBusiness/attendanceRepository";

export function registerAttendance(input) {
  const payload =
    typeof input === "string" ? { identifier: input, source: "manual" } : input;
  return recordAttendanceSupabase(payload);
}

export function listAttendance(options = {}) {
  return listAttendanceSupabase(options);
}

export function getAttendanceStatement(options = {}) {
  return getAttendanceStatementSupabase(options);
}

export function listAttendanceActivities(options = {}) {
  return listAttendanceActivitiesSupabase(options);
}

export function saveAttendanceActivity(options = {}) {
  return upsertAttendanceActivitySupabase(options);
}

export function setAttendanceActivityStatus(options = {}) {
  return setAttendanceActivityStatusSupabase(options);
}

export function listActivitySessions(options = {}) {
  return listActivitySessionsSupabase(options);
}

export function createActivitySession(options = {}) {
  return createActivitySessionSupabase(options);
}

export function createAttendanceException(options = {}) {
  return createAttendanceExceptionSupabase(options);
}

export function cancelAttendance(options = {}) {
  return cancelAttendanceSupabase(options);
}

export function updateAttendance() {
  return Promise.resolve({
    ok: false,
    code: "UNSUPPORTED_OPERATION",
    message:
      "La edición directa de asistencias no está disponible. Cancela el registro si fue capturado por error.",
  });
}

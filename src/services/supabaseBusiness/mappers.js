import {
  calculateAge,
  formatElementGroupLabel,
  getElementGroup,
} from "../../utils/elementGroups";

const DOCUMENT_LEGACY_FIELDS = Object.freeze({
  guardian_id: "ineTutor",
  medical_certificate: "certificadoMedico",
  proof_of_address: "comprobanteDomicilio",
  birth_certificate: "actaNacimiento",
  curp: "curp",
  enrollment_form: "hojaInscripcion",
});

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOpaqueId(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function mapDocumentMetadata(documents) {
  if (!Array.isArray(documents)) return {};

  return documents.reduce((fields, document) => {
    const legacyField = DOCUMENT_LEGACY_FIELDS[document?.type];
    if (legacyField) fields[legacyField] = "Sin documento";
    return fields;
  }, {});
}

const MONTH_NAMES = Object.freeze([
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
]);

const PAYMENT_METHOD_LABELS = Object.freeze({
  cash: "Efectivo",
  transfer: "Transferencia",
});

const PAYMENT_STATUS_LABELS = Object.freeze({
  paid: "Pagada",
  pending: "Pendiente",
  overdue: "Vencida",
  future: "Próxima",
  not_applicable: "No aplica",
  unconfigured: "Sin tarifa",
});

const PAYMENT_METHOD_VALUES = Object.freeze({
  efectivo: "cash",
  cash: "cash",
  transferencia: "transfer",
  transfer: "transfer",
});

const ATTENDANCE_STATUS_LABELS = Object.freeze({
  present: "Asistencia",
  absent: "Falta",
  late: "Retardo",
  excused: "Justificada",
});

const ATTENDANCE_STATUS_VALUES = Object.freeze({
  asistencia: "present",
  present: "present",
  falta: "absent",
  absent: "absent",
  retardo: "late",
  late: "late",
  justificada: "excused",
  excused: "excused",
});

const ATTENDANCE_SOURCE_LABELS = Object.freeze({
  manual: "Manual",
  qr: "QR",
});

const ATTENDANCE_CATEGORY_LABELS = Object.freeze({
  mandatory: "Obligatoria",
  activity: "Actividad",
  event: "Evento",
});

const ATTENDANCE_SESSION_STATUS_LABELS = Object.freeze({
  scheduled: "Programada",
  open: "Abierta",
  closed: "Cerrada",
  cancelled: "Cancelada",
});

const ATTENDANCE_STATEMENT_STATUS_LABELS = Object.freeze({
  present: "Asistencia",
  late: "Retardo",
  excused: "Justificada",
  absent: "Falta",
  exempt: "Exento",
  not_recorded: "Sin registro",
});

function toNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function centsToMoney(value) {
  return toNumber(value) / 100;
}

export function getMonthName(month) {
  return MONTH_NAMES[toNumber(month, 0) - 1] ?? String(month ?? "");
}

export function getMonthNumber(month) {
  if (Number.isInteger(month) && month >= 1 && month <= 12) return month;
  const normalized = normalizeText(month).toLowerCase();
  const index = MONTH_NAMES.findIndex(
    (monthName) => monthName.toLowerCase() === normalized
  );
  return index >= 0 ? index + 1 : null;
}

export function mapPaymentMethod(value) {
  const normalized = normalizeText(value).toLowerCase();
  return PAYMENT_METHOD_VALUES[normalized] ?? normalized;
}

export function mapAttendanceStatus(value) {
  const normalized = normalizeText(value).toLowerCase();
  return ATTENDANCE_STATUS_VALUES[normalized] ?? normalized;
}

export function formatSupabaseTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function mapElementSearchItem(item) {
  if (!item || typeof item !== "object") return null;

  const elementId = normalizeOpaqueId(item.element_id ?? item.elementId ?? item.id);
  if (!elementId) return null;

  const givenNames = normalizeText(item.given_names ?? item.givenNames);
  const paternalSurname = normalizeText(
    item.paternal_surname ?? item.paternalSurname
  );
  const maternalSurname = normalizeText(
    item.maternal_surname ?? item.maternalSurname
  );
  const displayName =
    normalizeText(item.display_name ?? item.displayName) ||
    [givenNames, paternalSurname, maternalSurname].filter(Boolean).join(" ") ||
    normalizeText(item.element_code ?? item.elementCode);
  const birthDate = item.birth_date ?? item.birthDate ?? "";
  const ageValue = item.age_years ?? item.ageYears ?? calculateAge(birthDate);
  const sexCode = item.sex_code ?? item.sexCode ?? "";
  const derivedGroup = getElementGroup({ birthDate, sex: sexCode });
  const fallbackGroup = formatElementGroupLabel(
    item.group_label ?? item.groupLabel ?? item.group_code ?? item.groupCode
  );
  const groupLabel = derivedGroup?.label ?? fallbackGroup;

  return {
    ID: elementId,
    Nombre: givenNames || displayName,
    Nombres: givenNames || displayName,
    ApellidoPaterno: paternalSurname,
    ApellidoMaterno: maternalSurname,
    displayName,
    FechaNacimiento: birthDate,
    edad: ageValue === null ? null : toNumber(ageValue, null),
    Sexo: sexCode,
    Grupo: groupLabel,
    Tutor: normalizeText(item.guardian_name ?? item.guardianName),
    TelefonoTutor: normalizeText(item.guardian_phone ?? item.guardianPhone),
    groupCode: groupLabel || null,
    status: item.status ?? null,
    elementCode: item.element_code ?? item.elementCode ?? null,
    enrollmentId: item.enrollment_id ?? item.enrollmentId ?? null,
    enrollmentCode: item.enrollment_code ?? item.enrollmentCode ?? null,
    enrolledOn: item.enrolled_on ?? item.enrolledOn ?? null,
    billingStartOn: item.billing_start_on ?? item.billingStartOn ?? null,
    billingPolicy: item.billing_policy ?? item.billingPolicy ?? null,
    createdAt: item.created_at ?? item.createdAt ?? null,
  };
}

export function mapElementDetails(payload) {
  const element = payload?.element;
  if (!element || typeof element !== "object") return null;

  const elementId = normalizeOpaqueId(element.elementId);
  if (!elementId) return null;

  const givenNames = normalizeText(element.givenNames);
  const paternalSurname = normalizeText(element.paternalSurname);
  const maternalSurname = normalizeText(element.maternalSurname);
  const displayName = [givenNames, paternalSurname, maternalSurname]
    .filter(Boolean)
    .join(" ");
  const documents = Array.isArray(payload.documents) ? payload.documents : [];
  const birthDate = element.birthDate ?? "";
  const sexCode = element.sexCode ?? "";
  const derivedGroup = getElementGroup({ birthDate, sex: sexCode });
  const fallbackGroup = formatElementGroupLabel(element.groupCode);
  const groupLabel = derivedGroup?.label ?? fallbackGroup;

  return {
    ID: elementId,
    CodigoElemento: element.elementCode ?? "",
    Nombre: givenNames,
    Nombres: givenNames,
    ApellidoPaterno: paternalSurname,
    ApellidoMaterno: maternalSurname,
    displayName,
    FechaNacimiento: birthDate,
    Sexo: sexCode,
    Grupo: groupLabel,
    Enfermedades: element.medicalNotes ?? "",
    Tutor: normalizeText(element.guardianName),
    TelefonoTutor: normalizeText(element.guardianPhone),
    enrollmentId: element.enrollmentId ?? null,
    enrollmentCode: element.enrollmentCode ?? "",
    enrolledOn: element.enrolledOn ?? null,
    billingStartOn: element.billingStartOn ?? null,
    billingPolicy: element.billingPolicy ?? null,
    status: element.status ?? null,
    version: element.version ?? null,
    createdAt: element.createdAt ?? null,
    updatedAt: element.updatedAt ?? null,
    activeEnrollment: payload.activeEnrollment ?? null,
    enrollments: Array.isArray(payload.enrollments) ? payload.enrollments : [],
    documents,
    ...mapDocumentMetadata(documents),
  };
}

export function mapCreateElementInput(input) {
  const sexCodeMap = {
    Masculino: "M",
    Femenino: "F",
  };
  const birthDate = input?.fechaNacimiento ?? input?.birthDate ?? null;
  const sexCode =
    sexCodeMap[input?.sexo] ?? normalizeText(input?.sexo ?? input?.sexCode);
  const derivedGroup = getElementGroup({
    birthDate,
    sex: sexCode,
  });

  return {
    p_given_names: normalizeText(input?.nombre ?? input?.givenNames),
    p_paternal_surname: normalizeText(
      input?.apellidoPaterno ?? input?.paternalSurname
    ),
    p_maternal_surname:
      normalizeText(input?.apellidoMaterno ?? input?.maternalSurname) || null,
    p_birth_date: birthDate,
    p_sex_code: sexCode,
    p_group_code:
      (derivedGroup?.label ??
        formatElementGroupLabel(input?.grupo ?? input?.groupCode)) ||
      null,
    p_medical_notes:
      normalizeText(input?.enfermedades ?? input?.medicalNotes) || null,
    p_guardian_name: normalizeText(input?.tutor ?? input?.guardianName),
    p_guardian_phone: normalizeText(
      input?.telefonoTutor ?? input?.guardianPhone
    ),
    p_enrolled_on: input?.fechaInscripcion ?? input?.enrolledOn ?? null,
    p_billing_policy:
      normalizeText(input?.billingPolicy) || "first_15_current_else_next",
  };
}

export function mapPaymentItem(item) {
  if (!item || typeof item !== "object") return null;

  const paymentId = normalizeOpaqueId(item.payment_id ?? item.paymentId);
  const month = toNumber(item.month, null);
  if (!paymentId || !month) return null;

  const status = item.status ?? "posted";
  const amountCents = toNumber(item.amount_cents ?? item.amountCents, 0);

  return {
    "ID Pago": paymentId,
    paymentCode: item.payment_code ?? item.paymentCode ?? "",
    row_number: paymentId,
    enrollmentId: item.enrollment_id ?? item.enrollmentId ?? null,
    Mes: getMonthName(month),
    month,
    Año: toNumber(item.year, new Date().getFullYear()),
    Cantidad: centsToMoney(amountCents),
    amountCents,
    currency: item.currency ?? "MXN",
    "Tipo de Pago":
      PAYMENT_METHOD_LABELS[item.method] ?? item.method ?? "Sin método",
    method: item.method ?? "",
    reference: item.reference ?? "",
    status,
    version: toNumber(item.version, 1),
    recordedAt: item.recorded_at ?? item.recordedAt ?? "",
    recordedAtLabel: formatSupabaseTimestamp(item.recorded_at ?? item.recordedAt),
    cancelledAt: item.cancelled_at ?? item.cancelledAt ?? "",
    cancelReason: item.cancel_reason ?? item.cancelReason ?? "",
    Pagado: status === "posted",
  };
}

export function mapPaymentsListResponse(payload, fallback = {}) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const payments = items.map(mapPaymentItem).filter(Boolean);

  return {
    "ID Elemento": normalizeOpaqueId(payload?.elementId ?? fallback.elementId),
    "Nombre Elemento": normalizeText(fallback.elementName),
    pagos: payments,
    rawItems: items,
  };
}

function mapStatementPayment(payment) {
  if (!payment || typeof payment !== "object") return null;

  return mapPaymentItem({
    payment_id: payment.paymentId ?? payment.payment_id,
    payment_code: payment.paymentCode ?? payment.payment_code,
    year: payment.year,
    month: payment.month,
    amount_cents: payment.amount?.value ?? payment.amount_cents,
    currency: payment.amount?.currency ?? payment.currency,
    method: payment.method,
    reference: payment.reference,
    status: payment.status,
    version: payment.version,
    recorded_at: payment.recordedAt ?? payment.recorded_at,
  });
}

function mapStatementMonth(item) {
  if (!item || typeof item !== "object") return null;

  const month = toNumber(item.month, null);
  const status = item.status ?? "pending";
  if (!month) return null;

  const amountCents = toNumber(item.amount?.value ?? item.amount_cents, 0);
  const payment = mapStatementPayment(item.payment);
  const latestCancellation = item.latestCancellation ?? item.latest_cancellation ?? null;

  return {
    year: toNumber(item.year, new Date().getFullYear()),
    month,
    Mes: getMonthName(month),
    periodStart: item.periodStart ?? item.period_start ?? null,
    status,
    statusLabel: PAYMENT_STATUS_LABELS[status] ?? status,
    amountCents,
    amount: centsToMoney(amountCents),
    currency: item.amount?.currency ?? item.currency ?? "MXN",
    payment,
    latestCancellation,
    isPaid: status === "paid",
    isPayable: ["pending", "overdue"].includes(status),
    isMuted: ["future", "not_applicable"].includes(status),
  };
}

export function mapPaymentStatementResponse(payload, fallback = {}) {
  const months = Array.isArray(payload?.months)
    ? payload.months.map(mapStatementMonth).filter(Boolean)
    : [];
  const summary = payload?.summary ?? {};

  return {
    "ID Elemento": normalizeOpaqueId(payload?.elementId ?? fallback.elementId),
    "Nombre Elemento": normalizeText(payload?.elementName ?? fallback.elementName),
    elementCode: payload?.elementCode ?? "",
    enrollmentId: payload?.enrollmentId ?? null,
    enrollmentCode: payload?.enrollmentCode ?? "",
    year: toNumber(payload?.year, new Date().getFullYear()),
    enrolledOn: payload?.enrolledOn ?? null,
    billingStartOn: payload?.billingStartOn ?? null,
    billingPolicy: payload?.billingPolicy ?? null,
    summary: {
      paidCount: toNumber(summary.paidCount, 0),
      pendingCount: toNumber(summary.pendingCount, 0),
      overdueCount: toNumber(summary.overdueCount, 0),
      futureCount: toNumber(summary.futureCount, 0),
      notApplicableCount: toNumber(summary.notApplicableCount, 0),
      unconfiguredCount: toNumber(summary.unconfiguredCount, 0),
      totalDueCents: toNumber(summary.totalDueCents, 0),
      totalPaidCents: toNumber(summary.totalPaidCents, 0),
      totalDue: centsToMoney(summary.totalDueCents),
      totalPaid: centsToMoney(summary.totalPaidCents),
    },
    months,
    pagos: months.map((month) => month.payment).filter(Boolean),
    rawMonths: payload?.months ?? [],
  };
}

export function mapPaymentCreated(payload) {
  return mapPaymentItem(payload?.payment);
}

export function mapAttendanceItem(item) {
  if (!item || typeof item !== "object") return null;

  const attendanceId = normalizeOpaqueId(
    item.attendance_id ?? item.attendanceId
  );
  if (!attendanceId) return null;

  const status = item.status ?? "present";
  const source = item.source ?? "manual";
  const occurredAt = item.occurred_at ?? item.occurredAt ?? "";
  const recordStatus = item.record_status ?? item.recordStatus ?? "active";

  return {
    "ID Asistencia": attendanceId,
    attendanceCode: item.attendance_code ?? item.attendanceCode ?? "",
    sessionId: item.session_id ?? item.sessionId ?? null,
    activityName: item.activity_name ?? item.activityName ?? "",
    row_number: attendanceId,
    FechaHora: formatSupabaseTimestamp(occurredAt),
    occurredAt,
    attendanceDate: item.attendance_date ?? item.attendanceDate ?? "",
    Estado: ATTENDANCE_STATUS_LABELS[status] ?? status,
    status,
    Tipo: ATTENDANCE_SOURCE_LABELS[source] ?? source,
    source,
    recordStatus,
    version: toNumber(item.version, 1),
    cancelledAt: item.cancelled_at ?? item.cancelledAt ?? "",
    cancelReason: item.cancel_reason ?? item.cancelReason ?? "",
  };
}

export function mapAttendanceActivity(item) {
  if (!item || typeof item !== "object") return null;

  const activityId = normalizeOpaqueId(item.activity_id ?? item.activityId);
  if (!activityId) return null;

  const category = item.category ?? "activity";

  return {
    activityId,
    name: normalizeText(item.name),
    category,
    categoryLabel: ATTENDANCE_CATEGORY_LABELS[category] ?? category,
    description: normalizeText(item.description),
    status: item.status ?? "active",
  };
}

export function mapActivitySession(item) {
  if (!item || typeof item !== "object") return null;

  const sessionId = normalizeOpaqueId(item.session_id ?? item.sessionId);
  if (!sessionId) return null;

  const category = item.category ?? "activity";
  const status = item.status ?? item.sessionStatus ?? "scheduled";

  return {
    sessionId,
    activityId: normalizeOpaqueId(item.activity_id ?? item.activityId),
    activityName: normalizeText(item.activity_name ?? item.activityName),
    category,
    categoryLabel: ATTENDANCE_CATEGORY_LABELS[category] ?? category,
    activityStatus: item.activity_status ?? item.activityStatus ?? "active",
    sessionDate: item.session_date ?? item.sessionDate ?? "",
    startsAt: item.starts_at ?? item.startsAt ?? "",
    endsAt: item.ends_at ?? item.endsAt ?? "",
    location: normalizeText(item.location),
    attendanceScope: item.attendance_scope ?? item.attendanceScope ?? "open",
    attendanceRequired: Boolean(
      item.attendance_required ?? item.attendanceRequired
    ),
    status,
    statusLabel: ATTENDANCE_SESSION_STATUS_LABELS[status] ?? status,
  };
}

export function mapAttendanceException(item) {
  if (!item || typeof item !== "object") return null;

  const exceptionId = normalizeOpaqueId(item.exception_id ?? item.exceptionId);
  if (!exceptionId) return null;

  return {
    exceptionId,
    scope: item.scope ?? "",
    weekday: item.weekday ?? null,
    sessionId: item.session_id ?? item.sessionId ?? null,
    startsOn: item.starts_on ?? item.startsOn ?? null,
    endsOn: item.ends_on ?? item.endsOn ?? null,
    reason: normalizeText(item.reason),
    status: item.status ?? "active",
  };
}

function mapAttendanceStatementSession(item) {
  const session = mapActivitySession({
    ...item,
    status: item?.session_status ?? item?.sessionStatus,
  });
  if (!session) return null;

  const status = item.status ?? "not_recorded";
  const attendance = mapAttendanceItem(item.attendance);

  return {
    ...session,
    statementStatus: status,
    statementStatusLabel:
      ATTENDANCE_STATEMENT_STATUS_LABELS[status] ?? status,
    isExempt: Boolean(item.is_exempt ?? item.isExempt),
    attendance,
  };
}

export function mapAttendanceActivitiesResponse(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.map(mapAttendanceActivity).filter(Boolean);
}

export function mapActivitySessionsResponse(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.map(mapActivitySession).filter(Boolean);
}

export function mapAttendanceStatementResponse(payload, fallback = {}) {
  const sessions = Array.isArray(payload?.sessions)
    ? payload.sessions.map(mapAttendanceStatementSession).filter(Boolean)
    : [];
  const records = Array.isArray(payload?.records)
    ? payload.records.map(mapAttendanceItem).filter(Boolean)
    : [];
  const exceptions = Array.isArray(payload?.exceptions)
    ? payload.exceptions.map(mapAttendanceException).filter(Boolean)
    : [];
  const summary = payload?.summary ?? {};

  return {
    "ID Elemento": normalizeOpaqueId(payload?.elementId ?? fallback.elementId),
    "Nombre Elemento": normalizeText(payload?.elementName ?? fallback.elementName),
    from: payload?.from ?? null,
    to: payload?.to ?? null,
    summary: {
      requiredSessions: toNumber(summary.requiredSessions, 0),
      presentCount: toNumber(summary.presentCount, 0),
      lateCount: toNumber(summary.lateCount, 0),
      excusedCount: toNumber(summary.excusedCount, 0),
      absentCount: toNumber(summary.absentCount, 0),
      exemptCount: toNumber(summary.exemptCount, 0),
      activityRecords: toNumber(summary.activityRecords, 0),
    },
    sessions,
    records,
    exceptions,
    Asistencias: records,
  };
}

export function mapAttendanceListResponse(payload, fallback = {}) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const records = items.map(mapAttendanceItem).filter(Boolean);

  return {
    "ID Elemento": normalizeOpaqueId(payload?.elementId ?? fallback.elementId),
    "Nombre Elemento": normalizeText(fallback.elementName),
    Asistencias: records,
    rawItems: items,
  };
}

export function mapAttendanceCreated(payload) {
  return mapAttendanceItem(payload?.attendance);
}

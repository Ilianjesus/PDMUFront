import { executeSupabaseRpc } from "./supabaseRpcClient";
import { supabase } from "../auth/supabaseClient";

const EMPTY_DASHBOARD = Object.freeze({
  resumenRapido: {
    elementosActivos: 0,
    pagosPendientes: 0,
    asistenciasHoy: 0,
  },
  alertasImportantes: [],
});

const FALLBACK_ERROR_CODES = new Set([
  "PGRST202",
  "PGRST204",
  "SUPABASE_RPC_ERROR",
  "42703",
  "42P01",
  "42883",
]);

function getMexicoDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day),
    date: `${value.year}-${value.month}-${value.day}`,
  };
}

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function firstDayOfMonth(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

async function fetchOptional(queryBuilder) {
  const { data, error } = await queryBuilder;
  if (error) return [];
  return Array.isArray(data) ? data : [];
}

async function getDashboardSummaryFallback() {
  const today = getMexicoDateParts();
  const currentMonthStart = new Date(today.year, today.month - 1, 1);

  const { data: elements, error: elementsError } = await supabase
    .from("elements")
    .select("id,given_names,paternal_surname,maternal_surname,billing_start_on,enrolled_on,created_at")
    .eq("status", "active")
    .limit(5000);

  if (elementsError) {
    return {
      ok: false,
      code: elementsError.code || "SUPABASE_QUERY_ERROR",
      message: "No se pudo cargar el resumen desde Supabase.",
      raw: elementsError,
    };
  }

  const activeElements = Array.isArray(elements) ? elements : [];
  const activeElementIds = new Set(activeElements.map((element) => element.id));

  const currentMonthPayments = await fetchOptional(
    supabase
      .from("payments")
      .select("element_id,year,month,status,recorded_at")
      .eq("status", "posted")
      .eq("year", today.year)
      .eq("month", today.month)
      .limit(10000)
  );

  const paidPeriods = new Set(
    currentMonthPayments
      .filter((payment) => activeElementIds.has(payment.element_id))
      .map((payment) => `${payment.element_id}:${monthKey(payment.year, payment.month)}`)
  );

  let currentMonthDuePeriods = 0;
  for (const element of activeElements) {
    const billingStart = firstDayOfMonth(
      element.billing_start_on || element.enrolled_on || element.created_at?.slice(0, 10)
    );
    if (!billingStart) continue;

    if (billingStart > currentMonthStart) continue;
    if (!paidPeriods.has(`${element.id}:${monthKey(today.year, today.month)}`)) {
      currentMonthDuePeriods += 1;
    }
  }

  const attendanceToday = await fetchOptional(
    supabase
      .from("attendance_records")
      .select("id,status,occurred_at")
      .eq("record_status", "active")
      .eq("attendance_date", today.date)
      .limit(5000)
  );

  const faltasHoy = attendanceToday.filter((item) => item.status === "absent").length;
  const asistenciasHoy = attendanceToday.filter((item) =>
    ["present", "late"].includes(item.status)
  ).length;

  const alertasImportantes = [];
  if (currentMonthDuePeriods > 0) {
    alertasImportantes.push(
      `${currentMonthDuePeriods} mensualidad(es) pendiente(s) de ${today.month}/${today.year}.`
    );
  }
  if (faltasHoy > 0) {
    alertasImportantes.push(`${faltasHoy} falta(s) registrada(s) hoy.`);
  }

  return {
    ok: true,
    data: {
      resumenRapido: {
        elementosActivos: activeElements.length,
        pagosPendientes: currentMonthDuePeriods,
        asistenciasHoy,
      },
      alertasImportantes,
    },
    raw: { source: "dashboard-fallback" },
    integration: "supabase-business",
  };
}

export async function getDashboardSummarySupabase() {
  const result = await executeSupabaseRpc("get_dashboard_summary");
  if (!result.ok) {
    if (FALLBACK_ERROR_CODES.has(result.code)) {
      return getDashboardSummaryFallback();
    }
    return result;
  }

  return {
    ...result,
    data: {
      ...EMPTY_DASHBOARD,
      ...result.data,
      resumenRapido: {
        ...EMPTY_DASHBOARD.resumenRapido,
        ...(result.data.resumenRapido ?? {}),
      },
      alertasImportantes: Array.isArray(result.data.alertasImportantes)
        ? result.data.alertasImportantes
        : [],
      actividadReciente: Array.isArray(result.data.actividadReciente)
        ? result.data.actividadReciente
        : [],
    },
  };
}

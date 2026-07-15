import { executeSupabaseRpc } from "./supabaseRpcClient";

const EMPTY_STATISTICS = Object.freeze({
  period: {
    from: "",
    to: "",
  },
  filters: {
    branch: "",
    category: "",
    activity: "",
  },
  summary: {
    activeElements: 0,
    newEnrollments: 0,
    pendingPayments: 0,
    pendingAmountCents: 0,
    attendanceRegistered: 0,
    requiredAbsences: 0,
  },
  attendanceAttention: [],
  paymentAttention: [],
  monthlyTrend: [],
});

function normalizeTextFilter(value) {
  return value ? String(value).trim().toLowerCase() : null;
}

function normalizeSummary(summary = {}) {
  return {
    ...EMPTY_STATISTICS.summary,
    ...summary,
    activeElements: Number(summary.activeElements ?? 0),
    newEnrollments: Number(summary.newEnrollments ?? 0),
    pendingPayments: Number(summary.pendingPayments ?? 0),
    pendingAmountCents: Number(summary.pendingAmountCents ?? 0),
    attendanceRegistered: Number(summary.attendanceRegistered ?? 0),
    requiredAbsences: Number(summary.requiredAbsences ?? 0),
  };
}

function normalizeAttentionList(list = []) {
  return Array.isArray(list) ? list : [];
}

export async function getOperationalStatisticsSupabase(filters = {}) {
  const result = await executeSupabaseRpc("get_operational_statistics", {
    p_from: filters.from || null,
    p_to: filters.to || null,
    p_branch: normalizeTextFilter(filters.branch),
    p_category: normalizeTextFilter(filters.category),
    p_activity: normalizeTextFilter(filters.activity),
  });

  if (!result.ok) return result;

  const data = result.data || {};

  return {
    ...result,
    data: {
      ...EMPTY_STATISTICS,
      ...data,
      period: {
        ...EMPTY_STATISTICS.period,
        ...(data.period ?? {}),
      },
      filters: {
        ...EMPTY_STATISTICS.filters,
        ...(data.filters ?? {}),
      },
      summary: normalizeSummary(data.summary),
      attendanceAttention: normalizeAttentionList(data.attendanceAttention),
      paymentAttention: normalizeAttentionList(data.paymentAttention),
      monthlyTrend: normalizeAttentionList(data.monthlyTrend),
    },
  };
}

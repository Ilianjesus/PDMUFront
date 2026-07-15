import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  ClipboardCheck,
  CreditCard,
  RefreshCw,
  TrendingUp,
  Users,
} from "lucide-react";
import { getOperationalStatistics } from "../services/statisticsService";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadingState } from "../components/ui/LoadingState";
import { PageHeader } from "../components/ui/PageHeader";
import { StatusMessage } from "../components/ui/StatusMessage";
import "../styles/Estadisticas.css";

const BRANCH_OPTIONS = [
  { value: "femenil", label: "Femenil" },
  { value: "varonil", label: "Varonil" },
];

const CATEGORY_OPTIONS = [
  { value: "menor", label: "Menor" },
  { value: "juvenil", label: "Juvenil" },
  { value: "mayor", label: "Mayor" },
];

const ACTIVITY_OPTIONS = [
  { value: "instruccion", label: "Instrucción" },
  { value: "natacion", label: "Natación" },
  { value: "atletismo", label: "Atletismo" },
  { value: "personalizado", label: "Personalizados" },
];

const TAB_OPTIONS = [
  { value: "resumen", label: "Resumen" },
  { value: "asistencias", label: "Asistencias" },
  { value: "pagos", label: "Pagos" },
];

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMonthRange(offset = 0) {
  const date = new Date();
  const start = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  const end = new Date(date.getFullYear(), date.getMonth() + offset + 1, 0);
  return {
    from: toDateInputValue(start),
    to: toDateInputValue(end),
  };
}

function formatCurrencyFromCents(value) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format((Number(value) || 0) / 100);
}

function formatShortDate(value) {
  if (!value) return "Sin registro";
  const normalizedValue = String(value);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)
    ? new Date(`${normalizedValue}T00:00:00`)
    : new Date(normalizedValue);
  if (Number.isNaN(date.getTime())) return "Sin registro";

  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatMonthLabel(year, month) {
  const date = new Date(Number(year), Number(month) - 1, 1);
  return new Intl.DateTimeFormat("es-MX", {
    month: "short",
    year: "numeric",
  }).format(date);
}

function normalizeCount(value) {
  return Number(value ?? 0).toLocaleString("es-MX");
}

function FilterButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      className={`statistics-filter-chip${active ? " is-active" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function MetricCard({ icon, label, value, tone = "neutral" }) {
  const Icon = icon;

  return (
    <article className={`statistics-metric statistics-metric--${tone}`}>
      <div className="statistics-metric__icon" aria-hidden="true">
        <Icon />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function AttentionRow({ item, type }) {
  const primaryValue =
    type === "payments"
      ? formatCurrencyFromCents(item.dueCents)
      : `${normalizeCount(item.absenceCount)} falta(s)`;

  const detail =
    type === "payments"
      ? `${normalizeCount(item.pendingMonths)} mensualidad(es)`
      : `${normalizeCount(item.presentCount)} asistencia(s) · ${normalizeCount(item.excusedCount)} justificada(s)`;

  return (
    <li className="statistics-attention-row">
      <div>
        <strong>{item.displayName || "Elemento sin nombre"}</strong>
        <span>{item.groupLabel || "Sin grupo"}</span>
      </div>
      <div>
        <strong>{primaryValue}</strong>
        <span>{type === "payments" ? `Último pago: ${formatShortDate(item.lastPaymentAt)}` : detail}</span>
      </div>
    </li>
  );
}

function TrendRow({ item, maxValue }) {
  const value = Number(item.attendanceCount || 0) + Number(item.paymentsCount || 0);
  const width = maxValue > 0 ? Math.max(8, Math.round((value / maxValue) * 100)) : 8;

  return (
    <li className="statistics-trend-row">
      <div className="statistics-trend-row__label">
        <strong>{formatMonthLabel(item.year, item.month)}</strong>
        <span>{normalizeCount(item.attendanceCount)} asistencias · {formatCurrencyFromCents(item.paymentsCents)}</span>
      </div>
      <div className="statistics-trend-row__track" aria-hidden="true">
        <span style={{ width: `${width}%` }} />
      </div>
    </li>
  );
}

export function Estadisticas() {
  const currentRange = useMemo(() => getMonthRange(0), []);
  const previousRange = useMemo(() => getMonthRange(-1), []);

  const [periodMode, setPeriodMode] = useState("current");
  const [customPeriod, setCustomPeriod] = useState(currentRange);
  const [filters, setFilters] = useState({
    branch: "",
    category: "",
    activity: "",
  });
  const [activeTab, setActiveTab] = useState("resumen");
  const [statistics, setStatistics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const queryFilters = useMemo(() => {
    const period =
      periodMode === "previous"
        ? previousRange
        : periodMode === "custom"
          ? customPeriod
          : currentRange;

    return {
      ...period,
      ...filters,
    };
  }, [currentRange, customPeriod, filters, periodMode, previousRange]);

  const loadStatistics = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const result = await getOperationalStatistics(queryFilters);
      if (!result.ok) throw new Error(result.message);
      setStatistics(result.data);
    } catch (loadError) {
      console.error("Error cargando estadísticas operativas:", loadError);
      setError(loadError?.message || "No se pudieron cargar las estadísticas.");
    } finally {
      setLoading(false);
    }
  }, [queryFilters]);

  useEffect(() => {
    loadStatistics();
  }, [loadStatistics]);

  const summary = statistics?.summary ?? {};
  const trendMax = useMemo(() => {
    const trend = statistics?.monthlyTrend ?? [];
    return trend.reduce((max, item) => {
      const value = Number(item.attendanceCount || 0) + Number(item.paymentsCount || 0);
      return Math.max(max, value);
    }, 0);
  }, [statistics]);

  function updateFilter(key, value) {
    setFilters((current) => ({
      ...current,
      [key]: current[key] === value ? "" : value,
    }));
  }

  return (
    <main className="statistics-page page-shell">
      <div className="page-shell__inner">
        <PageHeader
          eyebrow="Análisis"
          title="Estadísticas"
          infoTooltip="Indicadores históricos para revisar pagos, asistencia e inscripciones por periodo."
          actions={
            <button
              type="button"
              className="statistics-refresh-button"
              onClick={loadStatistics}
              disabled={loading}
              aria-label="Actualizar estadísticas"
            >
              <RefreshCw aria-hidden="true" />
            </button>
          }
        />

        <section className="statistics-control-panel" aria-label="Filtros de estadísticas">
          <div className="statistics-period-switch" role="group" aria-label="Periodo">
            <button
              type="button"
              className={periodMode === "current" ? "is-active" : ""}
              onClick={() => setPeriodMode("current")}
            >
              Mes actual
            </button>
            <button
              type="button"
              className={periodMode === "previous" ? "is-active" : ""}
              onClick={() => setPeriodMode("previous")}
            >
              Mes anterior
            </button>
            <button
              type="button"
              className={periodMode === "custom" ? "is-active" : ""}
              onClick={() => setPeriodMode("custom")}
            >
              Personalizado
            </button>
          </div>

          {periodMode === "custom" && (
            <div className="statistics-date-range">
              <label>
                Desde
                <input
                  type="date"
                  value={customPeriod.from}
                  onChange={(event) =>
                    setCustomPeriod((current) => ({ ...current, from: event.target.value }))
                  }
                />
              </label>
              <label>
                Hasta
                <input
                  type="date"
                  value={customPeriod.to}
                  onChange={(event) =>
                    setCustomPeriod((current) => ({ ...current, to: event.target.value }))
                  }
                />
              </label>
            </div>
          )}

          <div className="statistics-filter-group" aria-label="Rama">
            {BRANCH_OPTIONS.map((option) => (
              <FilterButton
                key={option.value}
                active={filters.branch === option.value}
                onClick={() => updateFilter("branch", option.value)}
              >
                {option.label}
              </FilterButton>
            ))}
          </div>

          <div className="statistics-filter-group" aria-label="Categoría">
            {CATEGORY_OPTIONS.map((option) => (
              <FilterButton
                key={option.value}
                active={filters.category === option.value}
                onClick={() => updateFilter("category", option.value)}
              >
                {option.label}
              </FilterButton>
            ))}
          </div>

          <div className="statistics-filter-group statistics-filter-group--activity" aria-label="Actividad">
            {ACTIVITY_OPTIONS.map((option) => (
              <FilterButton
                key={option.value}
                active={filters.activity === option.value}
                onClick={() => updateFilter("activity", option.value)}
              >
                {option.label}
              </FilterButton>
            ))}
          </div>
        </section>

        {error && (
          <StatusMessage variant="error" className="statistics-status">
            <span>{error}</span>
            <button type="button" onClick={loadStatistics} disabled={loading}>
              Reintentar
            </button>
          </StatusMessage>
        )}

        {loading && !statistics ? (
          <LoadingState compact label="Cargando estadísticas..." />
        ) : (
          <>
            <section className="statistics-metrics" aria-label="Indicadores principales">
              <MetricCard
                icon={Users}
                label="Elementos activos"
                value={normalizeCount(summary.activeElements)}
              />
              <MetricCard
                icon={CalendarDays}
                label="Nuevas inscripciones"
                value={normalizeCount(summary.newEnrollments)}
              />
              <MetricCard
                icon={CreditCard}
                label="Pagos pendientes"
                value={normalizeCount(summary.pendingPayments)}
                tone={summary.pendingPayments > 0 ? "warning" : "success"}
              />
              <MetricCard
                icon={BarChart3}
                label="Adeudo pendiente"
                value={formatCurrencyFromCents(summary.pendingAmountCents)}
                tone={summary.pendingAmountCents > 0 ? "warning" : "success"}
              />
              <MetricCard
                icon={ClipboardCheck}
                label="Asistencias registradas"
                value={normalizeCount(summary.attendanceRegistered)}
              />
              <MetricCard
                icon={TrendingUp}
                label="Faltas obligatorias"
                value={normalizeCount(summary.requiredAbsences)}
                tone={summary.requiredAbsences > 0 ? "danger" : "success"}
              />
            </section>

            <nav className="statistics-tabs" aria-label="Secciones de estadísticas">
              {TAB_OPTIONS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  className={activeTab === tab.value ? "is-active" : ""}
                  onClick={() => setActiveTab(tab.value)}
                >
                  {tab.label}
                </button>
              ))}
            </nav>

            {activeTab === "resumen" && (
              <section className="statistics-section" aria-labelledby="trend-title">
                <div className="statistics-section__header">
                  <h2 id="trend-title">Tendencia mensual</h2>
                  <span>{formatShortDate(queryFilters.from)} a {formatShortDate(queryFilters.to)}</span>
                </div>
                {(statistics?.monthlyTrend ?? []).length > 0 ? (
                  <ul className="statistics-trend-list">
                    {statistics.monthlyTrend.map((item) => (
                      <TrendRow
                        key={`${item.year}-${item.month}`}
                        item={item}
                        maxValue={trendMax}
                      />
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    title="Sin movimiento"
                    description="No hay datos consolidados para el periodo seleccionado."
                  />
                )}
              </section>
            )}

            {activeTab === "asistencias" && (
              <section className="statistics-section" aria-labelledby="attendance-title">
                <div className="statistics-section__header">
                  <h2 id="attendance-title">Seguimiento de asistencias</h2>
                  <span>{normalizeCount(summary.requiredAbsences)} falta(s) obligatoria(s)</span>
                </div>
                {(statistics?.attendanceAttention ?? []).length > 0 ? (
                  <ul className="statistics-attention-list">
                    {statistics.attendanceAttention.map((item) => (
                      <AttentionRow key={item.elementId} item={item} type="attendance" />
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    title="Sin faltas obligatorias"
                    description="No hay elementos que requieran seguimiento por asistencia."
                  />
                )}
              </section>
            )}

            {activeTab === "pagos" && (
              <section className="statistics-section" aria-labelledby="payments-title">
                <div className="statistics-section__header">
                  <h2 id="payments-title">Seguimiento de pagos</h2>
                  <span>{formatCurrencyFromCents(summary.pendingAmountCents)}</span>
                </div>
                {(statistics?.paymentAttention ?? []).length > 0 ? (
                  <ul className="statistics-attention-list">
                    {statistics.paymentAttention.map((item) => (
                      <AttentionRow key={item.elementId} item={item} type="payments" />
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    title="Sin pagos pendientes"
                    description="No hay adeudos para el periodo seleccionado."
                  />
                )}
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}

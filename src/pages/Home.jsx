import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { puntos } from "../data/Puntos";
import { getDashboardSummary } from "../services/dashboardService";
import { StatusMessage } from "../components/ui/StatusMessage";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import {
  AlertCircle,
  ArrowRight,
  ClipboardCheck,
  CreditCard,
  Info,
  RefreshCw,
  Search,
  UserPlus,
} from "lucide-react";
import "../styles/Home.css";

const SHOW_PDMU_PRINCIPLE = false;

function SectionTooltip({ label }) {
  return (
    <span className="info-tooltip section-info-tooltip" tabIndex={0} aria-label={label}>
      <Info aria-hidden="true" />
      <span className="info-tooltip__content" role="tooltip">
        {label}
      </span>
    </span>
  );
}

export function Home() {
  const [puntoAleatorio, setPuntoAleatorio] = useState("");
  const [loadingStats, setLoadingStats] = useState(true);
  const [dashboardError, setDashboardError] = useState("");

  const [resumenRapido, setResumenRapido] = useState([
    { label: "Elementos activos", value: "—", to: "/elementos" },
    { label: "Pagos pendientes", value: "—", to: "/pagos" },
    { label: "Asistencias hoy", value: "—", to: "/asistencia" },
  ]);

  const [alertasImportantes, setAlertasImportantes] = useState([]);

  useEffect(() => {
    if (!SHOW_PDMU_PRINCIPLE) return;
    const index = Math.floor(Math.random() * puntos.length);
    setPuntoAleatorio(puntos[index]);
  }, []);

  const cargarEstadisticas = useCallback(async () => {
    try {
      setLoadingStats(true);
      setDashboardError("");

      const result = await getDashboardSummary();

      if (!result.ok) throw new Error(result.message);

      const dashboardData = result.data || {};

      const resumen = dashboardData.resumenRapido || {};
      setResumenRapido([
        {
          label: "Elementos activos",
          value: resumen.elementosActivos ?? "—",
          to: "/elementos",
        },
        {
          label: "Pagos pendientes",
          value: resumen.pagosPendientes ?? "—",
          to: "/pagos",
        },
        {
          label: "Asistencias hoy",
          value: resumen.asistenciasHoy ?? "—",
          to: "/asistencia",
        },
      ]);

      if (
        Array.isArray(dashboardData.alertasImportantes) &&
        dashboardData.alertasImportantes.length > 0
      ) {
        setAlertasImportantes(
          dashboardData.alertasImportantes.map((item) =>
            typeof item === "string" ? item : item.texto || "Sin detalle"
          )
        );
      } else {
        setAlertasImportantes([]);
      }
    } catch (error) {
      console.error("Error cargando estadísticas:", error);
      setDashboardError(
        error?.message || "No se pudo cargar el resumen del sistema."
      );

      setResumenRapido([
        { label: "Elementos activos", value: "—", to: "/elementos" },
        { label: "Pagos pendientes", value: "—", to: "/pagos" },
        { label: "Asistencias hoy", value: "—", to: "/asistencia" },
      ]);

      setAlertasImportantes([]);
    } finally {
      setLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    cargarEstadisticas();
  }, [cargarEstadisticas]);

  return (
    <div className="home-container page-shell">
      <div className="page-shell__inner">
        <PageHeader
          title="Inicio"
          description="Accesos rápidos y pendientes de la jornada."
          infoTooltip="Vista general para revisar pagos, asistencia y pendientes."
          menuActions={[
            {
              id: "home-refresh",
              label: loadingStats ? "Consultando" : "Actualizar",
              icon: RefreshCw,
              onSelect: cargarEstadisticas,
              disabled: loadingStats,
            },
          ]}
        />

        <section className="home-quick-actions" aria-labelledby="quick-actions-title">
          <div className="section-header">
            <h2 className="section-title" id="quick-actions-title">¿Qué necesitas hacer?</h2>
          </div>
          <div className="home-quick-actions__grid">
            <Link className="home-action home-action--primary" to="/asistencia">
              <ClipboardCheck aria-hidden="true" />
              <span><strong>Tomar asistencia</strong><small>Abrir una sesión y escanear QR.</small></span>
              <ArrowRight aria-hidden="true" />
            </Link>
            <Link className="home-action" to="/elementos/nuevo">
              <UserPlus aria-hidden="true" />
              <span><strong>Nueva inscripción</strong><small>Capturar un expediente guiado.</small></span>
              <ArrowRight aria-hidden="true" />
            </Link>
            <Link className="home-action" to="/pagos">
              <CreditCard aria-hidden="true" />
              <span><strong>Registrar pago</strong><small>Buscar un elemento y actualizar su cuenta.</small></span>
              <ArrowRight aria-hidden="true" />
            </Link>
            <Link className="home-action" to="/elementos">
              <Search aria-hidden="true" />
              <span><strong>Buscar expediente</strong><small>Consultar información y documentos.</small></span>
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </section>

        {dashboardError && (
          <StatusMessage variant="error">
            <span>{dashboardError}</span>
            <button
              type="button"
              className="home-retry-button"
              onClick={cargarEstadisticas}
              disabled={loadingStats}
            >
              Reintentar
            </button>
          </StatusMessage>
        )}

        <section className="home-section" aria-labelledby="summary-title">
          <div className="section-header">
            <div className="section-title-row">
              <h2 className="section-title" id="summary-title">Vista rápida</h2>
              <SectionTooltip label="Indicadores consolidados del periodo actual." />
            </div>
          </div>

          <div className="summary-grid">
            {resumenRapido.map((item) => (
              <Link className="summary-card" to={item.to} key={item.label} aria-busy={loadingStats}>
                <span className="summary-label">{item.label}</span>
                <strong className="summary-value">
                  {loadingStats ? "—" : item.value}
                </strong>
                <ArrowRight className="summary-card__arrow" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>

        <section className="home-section" aria-label="Seguimiento operativo">
          <div className="section-header">
            <div className="section-title-row">
              <h2 className="section-title">Atención requerida</h2>
              <SectionTooltip label="Pendientes que requieren seguimiento." />
            </div>
          </div>

          <div className="section-card">
            {loadingStats ? (
              <div className="alerts-loading" aria-label="Consultando pendientes">
                <span />
                <span />
                <span />
              </div>
            ) : alertasImportantes.length > 0 ? (
              <ul className="section-list">
                {alertasImportantes.map((alerta, index) => (
                  <li className="section-list-item" key={index}>
                    <AlertCircle aria-hidden="true" />
                    <span>{alerta}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title="Sin pendientes críticos"
                description="La operación no requiere atención inmediata."
              />
            )}
          </div>
        </section>

        {SHOW_PDMU_PRINCIPLE && (
          <aside className="principle-banner" aria-label="Principio PDMU">
            <span>Principio PDMU</span>
            <blockquote>{puntoAleatorio}</blockquote>
          </aside>
        )}
      </div>
    </div>
  );
}

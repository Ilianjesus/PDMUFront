import { useCallback, useEffect, useState } from "react";
import { puntos } from "../data/Puntos";
import { getDashboardSummary } from "../services/dashboardService";
import { StatusMessage } from "../components/ui/StatusMessage";
import { PageHeader } from "../components/ui/PageHeader";
import { Info } from "lucide-react";
import "../styles/Home.css";

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
    { label: "Elementos activos", value: "—" },
    { label: "Asistencias hoy", value: "—" },
  ]);

  const [alertasImportantes, setAlertasImportantes] = useState([
    "Aquí se mostrarán alumnos con pagos atrasados.",
    "Aquí aparecerán documentos pendientes por cargar.",
    "Aquí se listarán alertas de faltas o incidencias importantes.",
  ]);

  useEffect(() => {
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
        },
        {
          label: "Asistencias hoy",
          value: resumen.asistenciasHoy ?? "—",
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
        setAlertasImportantes([
          "No hay alertas importantes por el momento.",
        ]);
      }
    } catch (error) {
      console.error("Error cargando estadísticas:", error);
      setDashboardError(
        error?.message || "No se pudo cargar el resumen del sistema."
      );

      setResumenRapido([
        { label: "Elementos activos", value: "—" },
        { label: "Asistencias hoy", value: "—" },
      ]);

      setAlertasImportantes([
        "No se pudieron cargar las alertas importantes.",
      ]);
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
          infoTooltip="Vista general para revisar pagos, asistencia y pendientes."
        />

        <aside className="principle-banner" aria-label="Principio PDMU">
          <span>Principio PDMU</span>
          <blockquote>{puntoAleatorio}</blockquote>
        </aside>

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
              <div className="summary-card" key={item.label}>
                <span className="summary-label">{item.label}</span>
                <strong className="summary-value">
                  {loadingStats ? "..." : item.value}
                </strong>
                <span className="summary-period">Actualizado al consultar</span>
              </div>
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
            <ul className="section-list">
              {alertasImportantes.map((alerta, index) => (
                <li className="section-list-item" key={index}>
                  {loadingStats ? "Cargando..." : alerta}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

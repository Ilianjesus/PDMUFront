import { useEffect, useState } from "react";
import { puntos } from "../data/Puntos";
import { useNavigate } from "react-router-dom";
import "../styles/Home.css";

export function Home() {
  const navigate = useNavigate();
  const [puntoAleatorio, setPuntoAleatorio] = useState("");
  const [loadingStats, setLoadingStats] = useState(true);

  const [resumenRapido, setResumenRapido] = useState([
    { label: "Elementos activos", value: "—" },
    { label: "Pagos pendientes", value: "—" },
    { label: "Asistencias hoy", value: "—" },
    { label: "Faltas hoy", value: "—" },
  ]);

  const [alertasImportantes, setAlertasImportantes] = useState([
    "Aquí se mostrarán alumnos con pagos atrasados.",
    "Aquí aparecerán documentos pendientes por cargar.",
    "Aquí se listarán alertas de faltas o incidencias importantes.",
  ]);

  const [actividadReciente, setActividadReciente] = useState([
    "Aquí se mostrará el último pago registrado.",
    "Aquí se verá la última asistencia registrada.",
    "Aquí aparecerán cambios recientes en información o documentos.",
  ]);

  useEffect(() => {
    const index = Math.floor(Math.random() * puntos.length);
    setPuntoAleatorio(puntos[index]);
  }, []);

  useEffect(() => {
    const cargarEstadisticas = async () => {
      try {
        setLoadingStats(true);

        const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_ESTATISTICS;

        if (!webhookUrl) {
          throw new Error("Falta la variable VITE_N8N_WEBHOOK_ESTATISTICS");
        }

        const response = await fetch(webhookUrl, {
          method: "GET",
        });

        if (!response.ok) {
          throw new Error("No se pudieron cargar las estadísticas");
        }

        const result = await response.json();

        if (!result || result.status !== "success") {
          throw new Error(result?.message || "Respuesta inválida del webhook");
        }

        const dashboardData = result.data || {};

        const resumen = dashboardData.resumenRapido || {};
        setResumenRapido([
          {
            label: "Elementos activos",
            value: resumen.elementosActivos ?? "—",
          },
          {
            label: "Pagos pendientes",
            value: resumen.pagosPendientes ?? "—",
          },
          {
            label: "Asistencias hoy",
            value: resumen.asistenciasHoy ?? "—",
          },
          {
            label: "Faltas hoy",
            value: resumen.faltasHoy ?? "—",
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

        if (
          Array.isArray(dashboardData.actividadReciente) &&
          dashboardData.actividadReciente.length > 0
        ) {
          setActividadReciente(
            dashboardData.actividadReciente.map((item) =>
              typeof item === "string" ? item : item.texto || "Sin detalle"
            )
          );
        } else {
          setActividadReciente([
            "No hay actividad reciente disponible.",
          ]);
        }
      } catch (error) {
        console.error("Error cargando estadísticas:", error);

        setResumenRapido([
          { label: "Elementos activos", value: "—" },
          { label: "Pagos pendientes", value: "—" },
          { label: "Asistencias hoy", value: "—" },
          { label: "Faltas hoy", value: "—" },
        ]);

        setAlertasImportantes([
          "No se pudieron cargar las alertas importantes.",
        ]);

        setActividadReciente([
          "No se pudo cargar la actividad reciente.",
        ]);
      } finally {
        setLoadingStats(false);
      }
    };

    cargarEstadisticas();
  }, []);

  const irARegistrarPago = () => {
    navigate("/RegistrarPago");
  };

  return (
    <div className="home-container">
      <h2 className="home-title">Home</h2>
      <p className="home-welcome">Bienvenido</p>

      <div className="punto-box">
        <blockquote>{puntoAleatorio}</blockquote>
      </div>

      <div className="home-section">
        <div className="section-header">
          <h3 className="section-title">Resumen rápido</h3>
          <p className="section-subtitle">
            Vista general del estado actual del sistema.
          </p>
        </div>

        <div className="summary-grid">
          {resumenRapido.map((item) => (
            <div className="summary-card" key={item.label}>
              <span className="summary-label">{item.label}</span>
              <strong className="summary-value">
                {loadingStats ? "..." : item.value}
              </strong>
            </div>
          ))}
        </div>
      </div>

      <div className="home-section">
        <div className="section-header">
          <h3 className="section-title">Alertas importantes</h3>
          <p className="section-subtitle">
            Elementos que requerirán atención prioritaria.
          </p>
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
      </div>

      <div className="home-section">
        <div className="section-header">
          <h3 className="section-title">Actividad reciente</h3>
          <p className="section-subtitle">
            Últimos movimientos registrados en la aplicación.
          </p>
        </div>

        <div className="section-card">
          <ul className="section-list">
            {actividadReciente.map((actividad, index) => (
              <li className="section-list-item" key={index}>
                {loadingStats ? "Cargando..." : actividad}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <button className="fab fab-primary" onClick={irARegistrarPago}>
        +
      </button>

      <button
        className="fab fab-secondary"
        onClick={() => navigate("/PanelAdmin")}
      >
        ⚙
      </button>
    </div>
  );
}
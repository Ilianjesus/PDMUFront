import { Link } from "react-router-dom";
import { BarChart3, LogOut, UserPlus, UsersRound } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { useAuth } from "../hooks/useAuth";
import "../styles/NavigationPages.css";

export function Mas() {
  const { operatorProfile, logout } = useAuth();

  return (
    <div className="more-page page-shell">
      <div className="page-shell__inner">
        <PageHeader
          title="Gestión"
          description="Reportes, inscripciones y herramientas administrativas."
        />

        <nav className="destination-list" aria-label="Gestión y administración">
          <Link to="/elementos/nuevo" className="destination-card">
            <UserPlus aria-hidden="true" />
            <span><strong>Nueva inscripción</strong><small>Captura un expediente guiado.</small></span>
          </Link>
          <Link to="/reportes" className="destination-card">
            <BarChart3 aria-hidden="true" />
            <span><strong>Reportes</strong><small>Consulta asistencia, pagos y tendencias.</small></span>
          </Link>
          {operatorProfile?.role === "admin" && (
            <Link to="/administracion/operadores" className="destination-card">
              <UsersRound aria-hidden="true" />
              <span><strong>Operadores</strong><small>Administra cuentas y permisos.</small></span>
            </Link>
          )}
          <button type="button" className="destination-card destination-card--danger" onClick={logout}>
            <LogOut aria-hidden="true" />
            <span><strong>Cerrar sesión</strong><small>Finaliza el acceso en este dispositivo.</small></span>
          </button>
        </nav>
      </div>
    </div>
  );
}

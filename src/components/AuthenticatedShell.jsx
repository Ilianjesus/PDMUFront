import { useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import logo from "../assets/logo.jpeg";
import "../styles/AuthenticatedShell.css";

export function AuthenticatedShell() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      setLogoutError("");
      await logout();
      navigate("/login", { replace: true });
    } catch (error) {
      console.error("No se pudo cerrar la sesión:", error);
      setLogoutError("No se pudo cerrar la sesión. Intenta nuevamente.");
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="authenticated-shell">
      <header className="session-header">
        <div className="session-brand" aria-label="PDMU APP">
          <img src={logo} alt="" aria-hidden="true" />
          <div>
            <strong>PDMU APP</strong>
            <span>Gestión operativa</span>
          </div>
        </div>
        <div className="session-account">
          <span className="session-identity" title={session?.email ?? undefined}>
            <span className="session-identity__label">Sesión activa</span>
            <strong>{session?.displayName || session?.email || "Operador"}</strong>
          </span>
          <button
            type="button"
            className="session-logout"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? "Cerrando..." : "Cerrar sesión"}
          </button>
        </div>
      </header>

      {logoutError && (
        <p className="session-error" role="alert">
          {logoutError}
        </p>
      )}

      <Outlet />
    </div>
  );
}

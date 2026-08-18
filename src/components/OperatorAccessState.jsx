import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../hooks/useAuth";

export function OperatorAccessState({ message }) {
  const { logout } = useAuth();
  const [closing, setClosing] = useState(false);

  const handleLogout = async () => {
    setClosing(true);
    try {
      await logout();
    } finally {
      setClosing(false);
    }
  };

  return (
    <main className="access-state">
      <div className="access-state__panel">
        <ShieldAlert aria-hidden="true" />
        <h1>Acceso no habilitado</h1>
        <p>{message}</p>
        <button type="button" className="ui-button ui-button--primary" onClick={handleLogout} disabled={closing}>
          {closing ? "Cerrando..." : "Volver al acceso"}
        </button>
      </div>
    </main>
  );
}

import { Outlet } from "react-router-dom";
import "../styles/AuthenticatedShell.css";

export function AuthenticatedShell() {
  return (
    <div className="authenticated-shell">
      <Outlet />
    </div>
  );
}

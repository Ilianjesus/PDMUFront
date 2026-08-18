import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export function RequireAdmin() {
  const { operatorProfile } = useAuth();
  if (operatorProfile?.role !== "admin") return <Navigate to="/home" replace />;
  return <Outlet />;
}

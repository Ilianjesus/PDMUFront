import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { AuthLoading } from "./AuthLoading";
import { OperatorAccessState } from "./OperatorAccessState";

export function RequireAuth() {
  const { authStatus, session, operatorProfile, profileStatus, profileError } = useAuth();
  const location = useLocation();

  if (authStatus === "loading" || profileStatus === "loading") {
    return <AuthLoading />;
  }

  if (authStatus !== "authenticated" || !session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (profileStatus === "error" || !operatorProfile) {
    return (
      <OperatorAccessState
        message={profileError || "Solicita a un administrador que habilite tu cuenta."}
      />
    );
  }

  if (operatorProfile.status !== "active") {
    return <OperatorAccessState message="Tu perfil de operador está inactivo." />;
  }

  return <Outlet />;
}

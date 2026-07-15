import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { AuthLoading } from "./AuthLoading";

export function RequireAuth() {
  const { authStatus, session } = useAuth();
  const location = useLocation();

  if (authStatus === "loading") {
    return <AuthLoading />;
  }

  if (authStatus !== "authenticated" || !session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

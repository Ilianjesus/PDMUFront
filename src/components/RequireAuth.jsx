import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export function RequireAuth({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    // Aquí puedes devolver un loader o nada mientras se verifica
    return <div>Cargando...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export function RequireAuth({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", marginTop: "20%" }}>
        <p>Cargando...</p>
      </div>
    );
  }

  // Revisar si hay usuario activo y el flag en localStorage
  if (!user) {
    return <Navigate to="/login" replace />;
  }  

  return children;
}

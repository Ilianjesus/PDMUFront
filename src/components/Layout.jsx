import { Outlet, Link, useLocation } from "react-router-dom";
import { Home as HomeIcon, ClipboardList, UserPlus, BarChart3 } from "lucide-react";


export function Layout() {
  const location = useLocation(); // para saber en qué ruta estás

  return (
    <div className="app-container">
      <div className="content">
        <Outlet /> {/* Aquí se cargan las páginas */}
      </div>

      {/* Tab Navigator */}
      <nav className="tab-nav">
        <Link to="/home" className={`tab-item ${location.pathname === "/home" ? "active" : ""}`}>
          <HomeIcon className="icon" />
          <span>Home</span>
        </Link>
        <Link to="/RegistrarElemento" className={`tab-item ${location.pathname === "/RegistrarElemento" ? "active" : ""}`}>
          <UserPlus className="icon" />
          <span>Registro</span>
        </Link>
        <Link to="/registrar-asistencia" className={`tab-item ${location.pathname === "/registrar-asistencia" ? "active" : ""}`}>
          <ClipboardList className="icon" />
          <span>Asistencias</span>
        </Link>
        <Link to="/Estadisticas" className={`tab-item ${location.pathname === "/Estadisticas" ? "active" : ""}`}>
          <BarChart3 className="icon" />
          <span>Estadísticas</span>
        </Link>
      </nav>
    </div>
  );
}

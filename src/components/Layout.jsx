import { createElement } from "react";
import { Outlet, NavLink } from "react-router-dom";
import {
  Home as HomeIcon,
  ClipboardCheck,
  UserPlus,
  ShieldCheck,
  BarChart3,
} from "lucide-react";
import "../styles/Layout.css";

const primaryItems = [
  { to: "/home", label: "Inicio", icon: HomeIcon },
  { to: "/PanelAdmin", label: "Elementos", icon: ShieldCheck },
  { to: "/RegistrarElemento", label: "Inscripciones", icon: UserPlus },
  { to: "/registrar-asistencia", label: "Asistencias", icon: ClipboardCheck },
];

function NavigationItem({ to, label, icon, secondary = false }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `app-nav__item${isActive ? " app-nav__item--active" : ""}${secondary ? " app-nav__item--secondary" : ""}`
      }
    >
      {createElement(icon, { "aria-hidden": true })}
      <span>{label}</span>
    </NavLink>
  );
}


export function Layout() {
  return (
    <div className="app-layout">
      <aside className="app-sidebar" aria-label="Navegación principal">
        <nav className="app-nav">
          <span className="app-nav__section-label">Operación</span>
          {primaryItems.map((item) => (
            <NavigationItem key={item.to} {...item} />
          ))}
          <span className="app-nav__section-label app-nav__section-label--secondary">
            Análisis
          </span>
          <NavigationItem
            to="/Estadisticas"
            label="Estadísticas"
            icon={BarChart3}
            secondary
          />
        </nav>
        <p className="app-sidebar__footer">Pentathlon Deportivo Militarizado Universitario</p>
      </aside>

      <main className="app-content" id="main-content">
        <Outlet />
      </main>

      <nav className="mobile-nav" aria-label="Navegación principal">
        {primaryItems.map((item) => (
          <NavigationItem key={item.to} {...item} />
        ))}
      </nav>
    </div>
  );
}

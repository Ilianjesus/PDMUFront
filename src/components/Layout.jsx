import { createElement } from "react";
import { Outlet, NavLink } from "react-router-dom";
import {
  Home as HomeIcon,
  ClipboardCheck,
  UserPlus,
  ShieldCheck,
  BarChart3,
  UsersRound,
} from "lucide-react";
import "../styles/Layout.css";
import { useAuth } from "../hooks/useAuth";

const primaryItems = [
  { to: "/home", label: "Inicio", icon: HomeIcon },
  { to: "/elementos", label: "Elementos", icon: ShieldCheck },
  { to: "/inscripciones", label: "Inscripciones", icon: UserPlus },
  { to: "/asistencias", label: "Asistencias", icon: ClipboardCheck },
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
  const { operatorProfile } = useAuth();

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
            to="/estadisticas"
            label="Estadísticas"
            icon={BarChart3}
            secondary
          />
          {operatorProfile?.role === "admin" && (
            <NavigationItem
              to="/operadores"
              label="Operadores"
              icon={UsersRound}
              secondary
            />
          )}
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

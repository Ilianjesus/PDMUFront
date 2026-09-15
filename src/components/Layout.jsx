import { createElement } from "react";
import { Link, Outlet, NavLink, useLocation } from "react-router-dom";
import {
  Home as HomeIcon,
  ClipboardCheck,
  CreditCard,
  Menu,
  UserPlus,
  ShieldCheck,
  BarChart3,
  UsersRound,
} from "lucide-react";
import "../styles/Layout.css";
import { useAuth } from "../hooks/useAuth";

const primaryItems = [
  { to: "/inicio", label: "Inicio", icon: HomeIcon },
  { to: "/asistencia", label: "Asistencia", icon: ClipboardCheck },
  { to: "/elementos", label: "Elementos", icon: ShieldCheck },
  { to: "/pagos", label: "Pagos", icon: CreditCard },
];

const mobileItems = [
  ...primaryItems,
  { to: "/mas", label: "Gestión", icon: Menu },
];

function NavigationItem({ to, label, icon, secondary = false, active = false }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `app-nav__item${isActive || active ? " app-nav__item--active" : ""}${secondary ? " app-nav__item--secondary" : ""}`
      }
    >
      {createElement(icon, { "aria-hidden": true })}
      <span>{label}</span>
    </NavLink>
  );
}


export function Layout() {
  const { operatorProfile } = useAuth();
  const location = useLocation();
  const moreIsActive =
    location.pathname.startsWith("/mas") ||
    location.pathname.startsWith("/reportes") ||
    location.pathname.startsWith("/administracion");

  return (
    <div className="app-layout">
      <aside className="app-sidebar" aria-label="Navegación principal">
        <nav className="app-nav">
          <span className="app-nav__section-label">Operación</span>
          {primaryItems.map((item) => (
            <NavigationItem key={item.to} {...item} />
          ))}
          <Link className="app-nav__primary-action" to="/elementos/nuevo">
            <UserPlus aria-hidden="true" />
            <span>Nueva inscripción</span>
          </Link>
          <span className="app-nav__section-label app-nav__section-label--secondary">
            Análisis
          </span>
          <NavigationItem
            to="/reportes"
            label="Reportes"
            icon={BarChart3}
            secondary
          />
          {operatorProfile?.role === "admin" && (
            <>
              <span className="app-nav__section-label app-nav__section-label--secondary">
                Administración
              </span>
              <NavigationItem
                to="/administracion/operadores"
                label="Operadores"
                icon={UsersRound}
                secondary
              />
            </>
          )}
        </nav>
        <p className="app-sidebar__footer">Pentathlon Deportivo Militarizado Universitario</p>
      </aside>

      <main className="app-content" id="main-content">
        <Outlet />
      </main>

      <nav className="mobile-nav" aria-label="Navegación principal">
        {mobileItems.map((item) => (
          <NavigationItem
            key={item.to}
            {...item}
            active={item.to === "/mas" && moreIsActive}
          />
        ))}
      </nav>
    </div>
  );
}

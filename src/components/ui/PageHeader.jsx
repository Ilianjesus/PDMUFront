import { createElement, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Info, LogOut, MoreVertical } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";

export function PageHeader({
  eyebrow,
  title,
  description,
  infoTooltip,
  actions,
  onBack,
  backLabel = "Volver",
  menuActions = [],
  children,
}) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const menuRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const hasMenuActions = menuActions.length > 0;

  useEffect(() => {
    if (!menuOpen) return undefined;

    const handlePointerDown = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const handleMenuAction = (action) => {
    if (action.disabled) return;
    setMenuOpen(false);
    action.onSelect?.();
  };

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      setMenuOpen(false);
      setLogoutError("");
      await logout();
      navigate("/login", { replace: true });
    } catch (error) {
      console.error("No se pudo cerrar la sesión:", error);
      setLogoutError("No se pudo cerrar la sesión. Intenta nuevamente.");
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <>
      <header className="page-header">
        <div className="page-header__inner">
          {onBack && (
            <button
              type="button"
              className="page-header__back"
              onClick={onBack}
              aria-label={backLabel}
            >
              <ArrowLeft aria-hidden="true" />
            </button>
          )}
          <div className="page-header__copy">
            {eyebrow && <span className="page-header__eyebrow">{eyebrow}</span>}
            <div className="page-header__title-row">
              <h1>{title}</h1>
              {infoTooltip && (
                <span className="info-tooltip" tabIndex={0} aria-label={infoTooltip}>
                  <Info aria-hidden="true" />
                  <span className="info-tooltip__content" role="tooltip">
                    {infoTooltip}
                  </span>
                </span>
              )}
            </div>
            {description && <p>{description}</p>}
          </div>
          <div className="page-header__actions">
            {actions}
            <div className="page-header-menu" ref={menuRef}>
              <button
                type="button"
                className="page-header-menu__trigger"
                onClick={() => setMenuOpen((current) => !current)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-label="Abrir menú de acciones"
              >
                <MoreVertical aria-hidden="true" />
              </button>
              {menuOpen && (
                <div className="page-header-menu__panel" role="menu">
                  {menuActions.map((action) => (
                    <button
                      type="button"
                      role="menuitem"
                      className="page-header-menu__item"
                      onClick={() => handleMenuAction(action)}
                      disabled={action.disabled}
                      key={action.id}
                    >
                      {action.icon && createElement(action.icon, { "aria-hidden": true })}
                      <span>{action.label}</span>
                    </button>
                  ))}
                  {hasMenuActions && <span className="page-header-menu__divider" />}
                  <button
                    type="button"
                    role="menuitem"
                    className="page-header-menu__item page-header-menu__item--danger"
                    onClick={handleLogout}
                    disabled={loggingOut}
                  >
                    <LogOut aria-hidden="true" />
                    <span>{loggingOut ? "Cerrando..." : "Cerrar sesión"}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
          {children}
        </div>
      </header>
      {logoutError && (
        <p className="page-header-error" role="alert">
          {logoutError}
        </p>
      )}
    </>
  );
}

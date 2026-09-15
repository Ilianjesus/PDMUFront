import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  XCircle,
} from "lucide-react";

const ICONS = {
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
  info: Info,
};

export function Toast({ toast, onDismiss }) {
  if (!toast) return null;

  const variant = toast.variant || "info";
  const Icon = ICONS[variant] || Info;
  const isError = variant === "error";

  return (
    <div className="app-toast-viewport" aria-live={isError ? "assertive" : "polite"}>
      <div
        className={`app-toast app-toast--${variant}`}
        role={isError ? "alert" : "status"}
      >
        <span className="app-toast__icon" aria-hidden="true">
          <Icon />
        </span>

        <div className="app-toast__content">
          <strong>{toast.title}</strong>
          {toast.text && <p>{toast.text}</p>}
        </div>

        <button
          type="button"
          className="app-toast__close"
          onClick={onDismiss}
          aria-label="Cerrar aviso"
          title="Cerrar aviso"
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

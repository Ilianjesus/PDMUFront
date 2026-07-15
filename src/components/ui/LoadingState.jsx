export function LoadingState({ label = "Cargando...", compact = false }) {
  return (
    <div
      className={`loading-state${compact ? " loading-state--compact" : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className="loading-state__spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

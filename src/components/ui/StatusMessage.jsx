export function StatusMessage({ children, variant = "info", className = "" }) {
  if (!children) return null;

  const isError = variant === "error";

  return (
    <div
      className={`status-message status-message--${variant} ${className}`.trim()}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
    >
      {children}
    </div>
  );
}

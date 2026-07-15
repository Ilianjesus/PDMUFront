export function EmptyState({ title = "Sin resultados", description }) {
  return (
    <div className="empty-state" role="status">
      <strong>{title}</strong>
      {description && <span>{description}</span>}
    </div>
  );
}

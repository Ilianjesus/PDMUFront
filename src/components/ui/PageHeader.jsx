import { Info } from "lucide-react";

export function PageHeader({
  eyebrow,
  title,
  description,
  infoTooltip,
  actions,
  children,
}) {
  return (
    <header className="page-header">
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
      {actions && <div className="page-header__actions">{actions}</div>}
      {children}
    </header>
  );
}

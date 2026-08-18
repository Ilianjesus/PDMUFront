import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

export function ConfirmDialog({
  open,
  title = "Confirmar acción",
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  busy = false,
  destructive = false,
  onConfirm,
  onCancel,
  children,
}) {
  const cancelButtonRef = useRef(null);
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  const busyRef = useRef(busy);
  const onCancelRef = useRef(onCancel);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    busyRef.current = busy;
    onCancelRef.current = onCancel;
  }, [busy, onCancel]);

  useEffect(() => {
    if (!open) return undefined;

    previousFocusRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelButtonRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !busyRef.current) onCancelRef.current();
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="ui-modal-overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="ui-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{message}</p>
        {children}
        <div className="ui-confirm-dialog__actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="ui-button ui-button--secondary"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`ui-button${destructive ? " ui-button--danger" : ""}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Procesando..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

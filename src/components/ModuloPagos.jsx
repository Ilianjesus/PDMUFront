import { useEffect, useMemo, useState } from "react";
import {
  cancelPayment,
  getPaymentStatement,
  registerPayment,
} from "../services/paymentsService";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { LoadingState } from "./ui/LoadingState";
import { StatusMessage } from "./ui/StatusMessage";
import { Info } from "lucide-react";
import "../styles/ModuloPagos.css";

const EMPTY_DIALOG = {
  visible: false,
  payment: null,
  reason: "",
};

const EMPTY_FORM = {
  period: null,
  method: "cash",
  reference: "",
};

const PAYMENT_HELP_TEXT =
  "Las mensualidades se calculan desde la fecha de inscripción. Los pagos se capturan manualmente cuando se reciben en efectivo o transferencia.";

function formatCurrency(value, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
  }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
  }).format(date);
}

function getPeriodLabel(period) {
  return `${period?.Mes ?? ""} ${period?.year ?? ""}`.trim();
}

function getPaymentState(month) {
  if (month.payment || month.status === "paid") {
    return {
      key: "paid",
      label: "Pagado",
      rowClass: "payment-row--paid",
    };
  }

  if (month.status === "future" || month.status === "not_applicable") {
    return {
      key: "future",
      label: "Próximo",
      rowClass: "payment-row--future",
    };
  }

  return {
    key: "unpaid",
    label: "No pagado",
    rowClass: "payment-row--unpaid",
  };
}

const ModuloPagos = ({ data }) => {
  const [statement, setStatement] = useState(data);
  const [paymentForm, setPaymentForm] = useState(EMPTY_FORM);
  const [dialog, setDialog] = useState(EMPTY_DIALOG);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    setStatement(data);
    setPaymentForm(EMPTY_FORM);
    setDialog(EMPTY_DIALOG);
    setMessage(null);
  }, [data]);

  const months = useMemo(
    () => (Array.isArray(statement?.months) ? statement.months : []),
    [statement]
  );
  const summary = statement?.summary ?? {};
  const elementId = statement?.["ID Elemento"];
  const elementName = statement?.["Nombre Elemento"] || "Elemento";
  const selectedPeriod = paymentForm.period;

  const visibleMonths = useMemo(
    () =>
      months.filter((month) =>
        ["paid", "pending", "overdue", "future", "unconfigured"].includes(
          month.status
        )
      ),
    [months]
  );

  const refreshStatement = async () => {
    if (!elementId || !statement?.year) return;

    const result = await getPaymentStatement({
      elementId,
      year: statement.year,
      elementName,
    });

    if (!result.ok) throw new Error(result.message);
    setStatement(result.data);
  };

  const openPaymentForm = (period) => {
    setMessage(null);
    setPaymentForm({
      period,
      method: "cash",
      reference: "",
    });
  };

  const closePaymentForm = () => {
    if (busy) return;
    setPaymentForm(EMPTY_FORM);
  };

  const handleRegisterPayment = async () => {
    if (busy || !selectedPeriod) return;

    if (paymentForm.method === "transfer" && !paymentForm.reference.trim()) {
      setMessage({
        variant: "error",
        text: "Captura una referencia para pagos por transferencia.",
      });
      return;
    }

    try {
      setBusy(true);
      setMessage(null);

      const result = await registerPayment({
        elementId,
        year: selectedPeriod.year,
        month: selectedPeriod.month,
        method: paymentForm.method,
        reference: paymentForm.reference,
      });

      if (!result.ok) throw new Error(result.message);

      await refreshStatement();
      setPaymentForm(EMPTY_FORM);
      setMessage({
        variant: "success",
        text: result.message || "Pago registrado correctamente.",
      });
    } catch (error) {
      console.error("Error registrando pago:", error);
      setMessage({
        variant: "error",
        text: error?.message || "No se pudo registrar el pago.",
      });
    } finally {
      setBusy(false);
    }
  };

  const openCancelDialog = (payment) => {
    setMessage(null);
    setDialog({
      visible: true,
      payment,
      reason: "",
    });
  };

  const closeCancelDialog = () => {
    if (busy) return;
    setDialog(EMPTY_DIALOG);
  };

  const handleCancelPayment = async () => {
    if (busy || !dialog.payment) return;

    if (!dialog.reason.trim()) {
      setMessage({
        variant: "error",
        text: "Captura el motivo de cancelación.",
      });
      return;
    }

    try {
      setBusy(true);
      setMessage(null);

      const result = await cancelPayment({
        paymentId: dialog.payment["ID Pago"],
        expectedVersion: dialog.payment.version,
        reason: dialog.reason,
      });

      if (!result.ok) throw new Error(result.message);

      await refreshStatement();
      setDialog(EMPTY_DIALOG);
      setMessage({
        variant: "success",
        text: result.message || "Pago cancelado correctamente.",
      });
    } catch (error) {
      console.error("Error cancelando pago:", error);
      setMessage({
        variant: "error",
        text: error?.message || "No se pudo cancelar el pago.",
      });
    } finally {
      setBusy(false);
    }
  };

  if (!statement) {
    return <LoadingState compact label="Cargando estado de cuenta..." />;
  }

  return (
    <div className="pagos-container">
      <div className="module-header payments-module-header">
        <div>
          <span>Mensualidades {statement.year}</span>
          <div className="payments-title-row">
            <h2 className="pagos-titulo">Estado de cuenta</h2>
            <span
              className="info-tooltip"
              tabIndex={0}
              aria-label={PAYMENT_HELP_TEXT}
            >
              <Info aria-hidden="true" />
              <span className="info-tooltip__content" role="tooltip">
                {PAYMENT_HELP_TEXT}
              </span>
            </span>
          </div>
        </div>
      </div>

      <section className="payments-summary" aria-label="Resumen de pagos">
        <div>
          <span>Inicio de cobro</span>
          <strong>{formatDate(statement.billingStartOn)}</strong>
        </div>
        <div>
          <span>Adeudo actual</span>
          <strong>{formatCurrency(summary.totalDue)}</strong>
        </div>
        <div>
          <span>Vencidas</span>
          <strong>{summary.overdueCount ?? 0}</strong>
        </div>
        <div>
          <span>Pagadas</span>
          <strong>{summary.paidCount ?? 0}</strong>
        </div>
      </section>

      {message && (
        <StatusMessage variant={message.variant}>{message.text}</StatusMessage>
      )}

      {selectedPeriod && (
        <section className="payment-entry-panel" aria-label="Registrar pago">
          <div>
            <span>Registrar pago</span>
            <strong>{getPeriodLabel(selectedPeriod)}</strong>
            <small>
              Importe: {formatCurrency(selectedPeriod.amount, selectedPeriod.currency)}
            </small>
          </div>

          <label>
            Método
            <select
              value={paymentForm.method}
              onChange={(event) =>
                setPaymentForm((current) => ({
                  ...current,
                  method: event.target.value,
                  reference: event.target.value === "cash" ? "" : current.reference,
                }))
              }
              disabled={busy}
            >
              <option value="cash">Efectivo</option>
              <option value="transfer">Transferencia</option>
            </select>
          </label>

          <label>
            Referencia
            <input
              type="text"
              value={paymentForm.reference}
              onChange={(event) =>
                setPaymentForm((current) => ({
                  ...current,
                  reference: event.target.value,
                }))
              }
              placeholder={
                paymentForm.method === "transfer"
                  ? "Folio, cuenta o comprobante"
                  : "Opcional"
              }
              disabled={busy || paymentForm.method === "cash"}
            />
          </label>

          <div className="payment-entry-panel__actions">
            <button
              type="button"
              className="btn-cancelar"
              onClick={closePaymentForm}
              disabled={busy}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn-guardar"
              onClick={handleRegisterPayment}
              disabled={busy}
            >
              {busy ? "Registrando..." : "Registrar"}
            </button>
          </div>
        </section>
      )}

      <section className="payments-ledger" aria-label="Mensualidades">
        <div className="payments-ledger__header">
          <span>Mensualidad</span>
          <span>Pago</span>
          <span>Importe</span>
          <span>Acción</span>
        </div>

        {visibleMonths.map((month) => {
          const paymentState = getPaymentState(month);

          return (
            <article
              className={`payment-row ${paymentState.rowClass}`}
              key={`${month.year}-${month.month}`}
            >
              <div className="payment-row__period">
                <strong>{getPeriodLabel(month)}</strong>
                {month.latestCancellation && (
                  <small>Última cancelación registrada</small>
                )}
              </div>

              <div>
                <span className={`payment-status payment-status--${paymentState.key}`}>
                  {paymentState.label}
                </span>
              </div>

              <div className="payment-row__amount">
                {month.status === "unconfigured"
                  ? "Sin tarifa"
                  : formatCurrency(month.amount, month.currency)}
              </div>

              <div className="payment-row__actions">
                {month.isPayable && (
                  <button
                    type="button"
                    className="btn-payment-action"
                    onClick={() => openPaymentForm(month)}
                    disabled={busy}
                  >
                    + Pago
                  </button>
                )}
                {month.payment && (
                  <button
                    type="button"
                    className="btn-eliminar"
                    onClick={() => openCancelDialog(month.payment)}
                    disabled={busy}
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </section>

      <ConfirmDialog
        open={dialog.visible}
        title="Cancelar pago"
        message="¿Seguro que deseas cancelar este pago? La mensualidad volverá a quedar pendiente si ya es exigible."
        confirmLabel="Cancelar pago"
        destructive
        busy={busy}
        onCancel={closeCancelDialog}
        onConfirm={handleCancelPayment}
      >
        <label className="payment-cancel-reason">
          Motivo de cancelación
          <textarea
            value={dialog.reason}
            onChange={(event) =>
              setDialog((current) => ({
                ...current,
                reason: event.target.value,
              }))
            }
            disabled={busy}
            rows={3}
          />
        </label>
      </ConfirmDialog>
    </div>
  );
};

export default ModuloPagos;

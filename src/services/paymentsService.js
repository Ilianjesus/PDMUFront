import {
  cancelPaymentSupabase,
  getPaymentStatementSupabase,
  listPaymentsSupabase,
  recordPaymentSupabase,
} from "./supabaseBusiness/paymentsRepository";

export function registerPayment(payload) {
  return recordPaymentSupabase(payload);
}

export async function registerPayments(payload = {}) {
  const months = Array.isArray(payload.months) ? payload.months : [payload.month];
  const created = [];

  for (const month of months) {
    const result = await recordPaymentSupabase({
      ...payload,
      month,
    });

    if (!result.ok) {
      return {
        ...result,
        data: created,
        message:
          created.length > 0
            ? `${result.message} Se registraron ${created.length} mensualidad(es) antes del error.`
            : result.message,
      };
    }

    created.push(result.data);
  }

  return {
    ok: true,
    data: created,
    integration: "supabase-business",
    message:
      created.length === 1
        ? "Pago registrado correctamente en Supabase."
        : "Pagos registrados correctamente en Supabase.",
  };
}

export function listPayments(options = {}) {
  return listPaymentsSupabase(options);
}

export function getPaymentStatement(options = {}) {
  return getPaymentStatementSupabase(options);
}

export function cancelPayment(options = {}) {
  return cancelPaymentSupabase(options);
}

export function updatePayment() {
  return Promise.resolve({
    ok: false,
    code: "UNSUPPORTED_OPERATION",
    message:
      "La edición directa de pagos no está disponible. Cancela el pago y registra uno nuevo.",
  });
}

import { executeSupabaseRpc } from "./supabaseRpcClient";
import {
  getMonthNumber,
  mapPaymentCreated,
  mapPaymentMethod,
  mapPaymentsListResponse,
  mapPaymentStatementResponse,
} from "./mappers";
import { createRequestId } from "./requestId";

function validationError(message, fieldErrors = {}) {
  return {
    ok: false,
    code: "VALIDATION_ERROR",
    message,
    fieldErrors,
    raw: null,
  };
}

function invalidResponse(message, raw) {
  return {
    ok: false,
    code: "INVALID_RESPONSE",
    message,
    raw,
  };
}

function normalizeElementId(elementId) {
  return typeof elementId === "string" ? elementId.trim() : "";
}

export async function recordPaymentSupabase({
  elementId,
  year,
  month,
  method = "cash",
  reference = null,
  requestId = null,
} = {}) {
  const normalizedElementId = normalizeElementId(elementId);
  const normalizedYear = Number(year);
  const normalizedMonth = getMonthNumber(month);
  const normalizedMethod = mapPaymentMethod(method);

  if (!normalizedElementId) return validationError("Selecciona un elemento válido.");
  if (!Number.isInteger(normalizedYear)) {
    return validationError("Selecciona un año válido.");
  }
  if (!normalizedMonth) return validationError("Selecciona un mes válido.");
  if (!["cash", "transfer"].includes(normalizedMethod)) {
    return validationError("Selecciona un método de pago válido.");
  }

  let operationId;
  try {
    operationId = requestId || createRequestId();
  } catch (error) {
    return {
      ok: false,
      code: "REQUEST_ID_UNAVAILABLE",
      message: error.message,
      raw: error,
    };
  }

  const result = await executeSupabaseRpc("record_payment", {
    p_request_id: operationId,
    p_element_id: normalizedElementId,
    p_year: normalizedYear,
    p_month: normalizedMonth,
    p_method: normalizedMethod,
    p_reference: typeof reference === "string" ? reference.trim() || null : null,
  });
  if (!result.ok) return result;

  const payment = mapPaymentCreated(result.data);
  if (!payment) {
    return invalidResponse("Supabase no confirmó el pago registrado.", result.raw);
  }

  return {
    ...result,
    data: payment,
    requestId: operationId,
    message: "Pago registrado correctamente en Supabase.",
  };
}

export async function listPaymentsSupabase({
  elementId,
  year = null,
  limit = 100,
  elementName = "",
} = {}) {
  const normalizedElementId = normalizeElementId(elementId);
  const normalizedYear = year === null ? null : Number(year);

  if (!normalizedElementId) return validationError("Selecciona un elemento válido.");
  if (year !== null && !Number.isInteger(normalizedYear)) {
    return validationError("Selecciona un año válido.");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return validationError("El límite debe ser un entero entre 1 y 200.");
  }

  const result = await executeSupabaseRpc("list_payments", {
    p_element_id: normalizedElementId,
    p_year: normalizedYear,
    p_limit: limit,
  });
  if (!result.ok) return result;

  const data = mapPaymentsListResponse(result.data, {
    elementId: normalizedElementId,
    elementName,
  });

  return {
    ...result,
    data,
  };
}

export async function getPaymentStatementSupabase({
  elementId,
  year = new Date().getFullYear(),
  elementName = "",
} = {}) {
  const normalizedElementId = normalizeElementId(elementId);
  const normalizedYear = Number(year);

  if (!normalizedElementId) return validationError("Selecciona un elemento válido.");
  if (!Number.isInteger(normalizedYear)) {
    return validationError("Selecciona un año válido.");
  }

  const result = await executeSupabaseRpc("get_element_payment_statement", {
    p_element_id: normalizedElementId,
    p_year: normalizedYear,
  });
  if (!result.ok) return result;

  const data = mapPaymentStatementResponse(result.data, {
    elementId: normalizedElementId,
    elementName,
  });

  return {
    ...result,
    data,
  };
}

export async function cancelPaymentSupabase({
  paymentId,
  expectedVersion,
  reason,
  requestId = null,
} = {}) {
  const normalizedPaymentId = normalizeElementId(paymentId);
  const normalizedVersion = Number(expectedVersion);
  const normalizedReason = typeof reason === "string" ? reason.trim() : "";

  if (!normalizedPaymentId) return validationError("Selecciona un pago válido.");
  if (!Number.isInteger(normalizedVersion)) {
    return validationError("Recarga el pago antes de cancelarlo.");
  }
  if (!normalizedReason) return validationError("Captura un motivo de cancelación.");

  let operationId;
  try {
    operationId = requestId || createRequestId();
  } catch (error) {
    return {
      ok: false,
      code: "REQUEST_ID_UNAVAILABLE",
      message: error.message,
      raw: error,
    };
  }

  const result = await executeSupabaseRpc("cancel_payment", {
    p_request_id: operationId,
    p_payment_id: normalizedPaymentId,
    p_expected_version: normalizedVersion,
    p_reason: normalizedReason,
  });
  if (!result.ok) return result;

  return {
    ...result,
    requestId: operationId,
    message: "Pago cancelado correctamente en Supabase.",
  };
}

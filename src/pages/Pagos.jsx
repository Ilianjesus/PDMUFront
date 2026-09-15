import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, ArrowUpRight, CircleDollarSign, RefreshCw, Search } from "lucide-react";
import Buscador from "../components/Buscador";
import ModuloPagos from "../components/ModuloPagos";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadingState } from "../components/ui/LoadingState";
import { PageHeader } from "../components/ui/PageHeader";
import { StatusMessage } from "../components/ui/StatusMessage";
import { getElement } from "../services/elementsService";
import { getPaymentStatement } from "../services/paymentsService";
import { getOperationalStatistics } from "../services/statisticsService";
import "../styles/Pagos.css";

const ATTENTION_LIMIT = 6;

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCurrentMonthRange() {
  const now = new Date();
  return {
    from: toDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toDateInputValue(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

function formatCurrencyFromCents(value) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format((Number(value) || 0) / 100);
}

function getElementName(element) {
  return (
    element?.displayName ||
    [element?.Nombre, element?.ApellidoPaterno, element?.ApellidoMaterno]
      .filter(Boolean)
      .join(" ") ||
    "Elemento"
  );
}

export function Pagos() {
  const [searchParams, setSearchParams] = useSearchParams();
  const elementId = searchParams.get("elemento") || "";
  const [selectedElement, setSelectedElement] = useState(null);
  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attention, setAttention] = useState([]);
  const [attentionSummary, setAttentionSummary] = useState(null);
  const [loadingAttention, setLoadingAttention] = useState(true);
  const [attentionError, setAttentionError] = useState("");

  const loadAttention = useCallback(async () => {
    try {
      setLoadingAttention(true);
      setAttentionError("");
      const result = await getOperationalStatistics(getCurrentMonthRange());
      if (!result.ok) throw new Error(result.message);

      setAttention((result.data?.paymentAttention ?? []).slice(0, ATTENTION_LIMIT));
      setAttentionSummary(result.data?.summary ?? null);
    } catch (loadError) {
      console.error("No se pudo cargar el seguimiento de pagos:", loadError);
      setAttention([]);
      setAttentionSummary(null);
      setAttentionError(
        loadError?.message || "No se pudo cargar la lista de pagos pendientes."
      );
    } finally {
      setLoadingAttention(false);
    }
  }, []);

  const loadStatement = useCallback(async (id, knownElement = null) => {
    if (!id) return;

    try {
      setLoading(true);
      setError("");
      setStatement(null);

      let element = knownElement;
      if (!element) {
        const elementResult = await getElement({ elementId: id, include: ["profile"] });
        if (!elementResult.ok) throw new Error(elementResult.message);
        element = elementResult.data;
      }

      const paymentResult = await getPaymentStatement({
        elementId: id,
        elementName: getElementName(element),
        year: new Date().getFullYear(),
      });
      if (!paymentResult.ok) throw new Error(paymentResult.message);

      setSelectedElement(element);
      setStatement(paymentResult.data);
    } catch (loadError) {
      console.error("No se pudo cargar el control de pagos:", loadError);
      setSelectedElement(knownElement);
      setError(loadError?.message || "No se pudo cargar el estado de cuenta.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!elementId) {
      setSelectedElement(null);
      setStatement(null);
      setError("");
      return;
    }
    void loadStatement(elementId);
  }, [elementId, loadStatement]);

  useEffect(() => {
    void loadAttention();
  }, [loadAttention]);

  const handleSelect = (element) => {
    setSelectedElement(element);
    setSearchParams({ elemento: element.ID });
  };

  const handleAttentionSelect = (item) => {
    setSelectedElement({
      ID: item.elementId,
      displayName: item.displayName,
    });
    setSearchParams({ elemento: item.elementId });
  };

  return (
    <div className="payments-control page-shell">
      <div className="page-shell__inner">
        <PageHeader
          title="Pagos"
          description="Consulta y registra pagos recibidos. Esta sección no procesa cobros."
        />

        <section className="payments-control__search" aria-label="Buscar estado de cuenta">
          <div>
            <Search aria-hidden="true" />
            <Buscador
              placeholder="Buscar por nombre o código"
              ariaLabel="Buscar elemento para consultar pagos"
              onSeleccionar={handleSelect}
            />
          </div>
          {selectedElement && (
            <div className="payments-control__selection">
              <span>Estado de cuenta</span>
              <strong>{getElementName(selectedElement)}</strong>
              <Link to={`/elementos/${selectedElement.ID}/informacion`}>
                Abrir expediente <ArrowUpRight aria-hidden="true" />
              </Link>
            </div>
          )}
        </section>

        {error && <StatusMessage variant="error">{error}</StatusMessage>}
        {loading && <LoadingState compact label="Cargando estado de cuenta..." />}
        {!loading && statement && <ModuloPagos data={statement} />}
        {!loading && !statement && !error && (
          <section className="payments-inbox" aria-labelledby="payments-inbox-title">
            <div className="payments-inbox__header">
              <div>
                <span>Seguimiento del mes</span>
                <h2 id="payments-inbox-title">Pagos pendientes</h2>
              </div>
              <button
                type="button"
                onClick={loadAttention}
                disabled={loadingAttention}
                aria-label="Actualizar pagos pendientes"
                title="Actualizar"
              >
                <RefreshCw aria-hidden="true" />
              </button>
            </div>

            {attentionSummary && (
              <div className="payments-inbox__summary" aria-label="Resumen de pagos pendientes">
                <div>
                  <CircleDollarSign aria-hidden="true" />
                  <span>Adeudo registrado</span>
                  <strong>{formatCurrencyFromCents(attentionSummary.pendingAmountCents)}</strong>
                </div>
                <div>
                  <span>Mensualidades pendientes</span>
                  <strong>{Number(attentionSummary.pendingPayments ?? 0).toLocaleString("es-MX")}</strong>
                </div>
              </div>
            )}

            {attentionError && (
              <StatusMessage variant="error">
                <span>{attentionError}</span>
                <button type="button" onClick={loadAttention} disabled={loadingAttention}>
                  Reintentar
                </button>
              </StatusMessage>
            )}

            {loadingAttention ? (
              <LoadingState compact label="Consultando pagos pendientes..." />
            ) : attention.length > 0 ? (
              <ul className="payments-inbox__list">
                {attention.map((item) => (
                  <li key={item.elementId}>
                    <button type="button" onClick={() => handleAttentionSelect(item)}>
                      <span className="payments-inbox__identity">
                        <strong>{item.displayName || "Elemento sin nombre"}</strong>
                        <small>
                          {item.groupLabel || "Sin grupo"} · {Number(item.pendingMonths ?? 0)} mensualidad(es)
                        </small>
                      </span>
                      <span className="payments-inbox__amount">
                        <strong>{formatCurrencyFromCents(item.dueCents)}</strong>
                        <ArrowRight aria-hidden="true" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : !attentionError ? (
              <EmptyState
                title="Sin pagos pendientes"
                description="No hay adeudos que requieran seguimiento este mes."
              />
            ) : null}
          </section>
        )}
      </div>
    </div>
  );
}

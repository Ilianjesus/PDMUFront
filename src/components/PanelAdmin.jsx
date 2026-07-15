import { useCallback, useEffect, useMemo, useState } from "react";
import Buscador from "../components/Buscador";
import ModuloInfo from "../components/ModuloInfo";
import ModuloPagos from "../components/ModuloPagos";
import ModuloAsistencias from "../components/ModuloAsistencias";
import { deactivateElement, getElement, listElements } from "../services/elementsService";
import { getPaymentStatement } from "../services/paymentsService";
import { getAttendanceStatement } from "../services/attendanceService";
import { EmptyState } from "./ui/EmptyState";
import { LoadingState } from "./ui/LoadingState";
import { StatusMessage } from "./ui/StatusMessage";
import { PageHeader } from "./ui/PageHeader";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import {
  ArrowLeft,
  ClipboardCheck,
  CreditCard,
  FileText,
  RefreshCw,
  Search,
  UserX,
} from "lucide-react";

import "../styles/PanelAdmin.css";

const BRANCH_FILTERS = [
  {
    value: "femenil",
    label: "Femenil",
    match: (group) => normalizeGroupText(group).includes("femenil"),
  },
  {
    value: "varonil",
    label: "Varonil",
    match: (group) => normalizeGroupText(group).includes("varonil"),
  },
];

const CATEGORY_FILTERS = [
  {
    value: "minor",
    label: "Menor",
    match: (group) => normalizeGroupText(group).includes("menor"),
  },
  {
    value: "youth",
    label: "Juvenil",
    match: (group) => normalizeGroupText(group).includes("juvenil"),
  },
  {
    value: "adult",
    label: "Mayor",
    match: (group) => normalizeGroupText(group).includes("mayor"),
  },
];

function normalizeGroupText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const PanelAdmin = () => {
  const [seleccionado, setSeleccionado] = useState(null);
  const [modulo, setModulo] = useState("");
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState(null);
  const [elementos, setElementos] = useState([]);
  const [cargandoElementos, setCargandoElementos] = useState(true);
  const [elementosError, setElementosError] = useState("");
  const [filtroRama, setFiltroRama] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [bajaDialog, setBajaDialog] = useState({
    visible: false,
    reason: "",
  });

  useEffect(() => {
    if (!mensaje) return undefined;
    const timer = window.setTimeout(() => setMensaje(null), 4000);
    return () => window.clearTimeout(timer);
  }, [mensaje]);

  const mostrarMensaje = (texto, tipo = "success") => {
    setMensaje({ texto, tipo });
  };

  const cargarElementos = useCallback(async () => {
    try {
      setCargandoElementos(true);
      setElementosError("");

      const result = await listElements({ limit: 500, status: "active" });
      if (!result.ok) throw new Error(result.message);

      setElementos(result.data);
    } catch (error) {
      console.error("Error cargando elementos:", error);
      setElementos([]);
      setElementosError(error?.message || "No se pudo cargar la lista de elementos.");
    } finally {
      setCargandoElementos(false);
    }
  }, []);

  useEffect(() => {
    cargarElementos();
  }, [cargarElementos]);

  const handleCargarModulo = async (moduloSeleccionado, item = seleccionado) => {
    if (!item?.ID) {
      mostrarMensaje("Selecciona un elemento primero", "error");
      return;
    }

    setSeleccionado(item);
    setModulo(moduloSeleccionado);
    setData(null);
    setMensaje(null);
    setCargando(true);

    try {
      let result;
      const elementName =
        item.displayName ||
        `${item.Nombre ?? ""} ${item.ApellidoPaterno ?? ""} ${item.ApellidoMaterno ?? ""}`.trim();

      if (moduloSeleccionado === "Informacion") {
        result = await getElement({
          elementId: item.ID,
          include: ["profile", "documents"],
        });
      } else if (moduloSeleccionado === "Pagos") {
        result = await getPaymentStatement({
          elementId: item.ID,
          elementName,
          year: new Date().getFullYear(),
        });
      } else if (moduloSeleccionado === "Asistencias") {
        result = await getAttendanceStatement({
          elementId: item.ID,
          elementName,
        });
      }

      if (!result.ok) throw new Error(result.message);

      const responseData = result.data;

      if (!responseData || Object.keys(responseData).length === 0) {
        mostrarMensaje("No se encontraron datos para este módulo", "error");
        setData(null);
      } else {
        setData(responseData);
      }
    } catch (error) {
      console.error(error);
      mostrarMensaje(
        error?.response?.data?.message ||
          error?.message ||
          "Error al cargar datos",
        "error"
      );
      setData(null);
    } finally {
      setCargando(false);
    }
  };

  const handleSeleccionar = (item) => {
    handleCargarModulo("Informacion", item);
  };

  const handleVolverListado = () => {
    setSeleccionado(null);
    setModulo("");
    setData(null);
    setMensaje(null);
    setBajaDialog({ visible: false, reason: "" });
  };

  const abrirBaja = () => {
    setMensaje(null);
    setBajaDialog({ visible: true, reason: "" });
  };

  const cerrarBaja = () => {
    if (cargando) return;
    setBajaDialog({ visible: false, reason: "" });
  };

  const confirmarBaja = async () => {
    if (!seleccionado?.ID || cargando) return;

    if (!bajaDialog.reason.trim()) {
      mostrarMensaje("Captura el motivo de baja.", "error");
      return;
    }

    try {
      setCargando(true);
      setMensaje(null);

      const result = await deactivateElement({
        elementId: seleccionado.ID,
        reason: bajaDialog.reason,
      });

      if (!result.ok) throw new Error(result.message);

      setBajaDialog({ visible: false, reason: "" });
      setSeleccionado(null);
      setModulo("");
      setData(null);
      await cargarElementos();
      mostrarMensaje(result.message || "Elemento dado de baja correctamente.");
    } catch (error) {
      console.error("Error dando de baja:", error);
      mostrarMensaje(error?.message || "No se pudo dar de baja el elemento.", "error");
    } finally {
      setCargando(false);
    }
  };

  const getElementName = (item) =>
    item?.displayName ||
    `${item?.Nombre ?? ""} ${item?.ApellidoPaterno ?? ""} ${item?.ApellidoMaterno ?? ""}`.trim() ||
    "Elemento sin nombre";

  const getBasicInfo = (item) => {
    if (item?.Grupo) return `Grupo ${item.Grupo}`;
    return "Grupo pendiente";
  };

  const elementosFiltrados = useMemo(() => {
    const branchFilter =
      BRANCH_FILTERS.find((filter) => filter.value === filtroRama) ?? null;
    const categoryFilter =
      CATEGORY_FILTERS.find((filter) => filter.value === filtroCategoria) ??
      null;

    return elementos.filter((item) => {
      const matchesBranch = !branchFilter || branchFilter.match(item?.Grupo);
      const matchesCategory = !categoryFilter || categoryFilter.match(item?.Grupo);
      return matchesBranch && matchesCategory;
    });
  }, [elementos, filtroCategoria, filtroRama]);

  const filtrosActivos = Boolean(filtroRama || filtroCategoria);

  return (
    <div className="panel-container page-shell">
      <div className="page-shell__inner">
        <PageHeader
          eyebrow="Administración"
          title="Elementos"
          infoTooltip="Consulta elementos, información básica, pagos y asistencias."
          actions={
            !seleccionado && (
              <button
                type="button"
                className="panel-refresh-icon"
                onClick={cargarElementos}
                disabled={cargandoElementos}
                aria-label="Actualizar elementos"
                title="Actualizar elementos"
              >
                <RefreshCw aria-hidden="true" />
              </button>
            )
          }
        />

      {mensaje && (
        <StatusMessage variant={mensaje.tipo}>
          {mensaje.texto}
        </StatusMessage>
      )}

      {!seleccionado && (
        <section className="panel-directory" aria-labelledby="elements-list-title">
          <div className="panel-directory__sticky">
            <div className="panel-search" aria-label="Buscar elemento">
              <span
                className="info-tooltip panel-search__icon"
                tabIndex={0}
                aria-label="Busca por nombre completo."
              >
                <Search aria-hidden="true" />
                <span className="info-tooltip__content" role="tooltip">
                  Busca por nombre completo.
                </span>
              </span>
              <Buscador
                placeholder="Buscar por nombre"
                onSeleccionar={handleSeleccionar}
              />
            </div>

            <div className="panel-filters" aria-label="Filtros de elementos">
              <div className="panel-directory-count" id="elements-list-title">
                {cargandoElementos
                  ? "Cargando..."
                  : `${elementosFiltrados.length} de ${elementos.length} activos`}
              </div>

              <fieldset className="panel-filter-group">
                <legend>Rama</legend>
                <div className="panel-filter-segment" role="group" aria-label="Filtrar por rama">
                  {BRANCH_FILTERS.map((filter) => (
                    <button
                      type="button"
                      key={filter.value}
                      className={filtroRama === filter.value ? "active" : ""}
                      onClick={() =>
                        setFiltroRama((current) =>
                          current === filter.value ? "" : filter.value
                        )
                      }
                      disabled={cargandoElementos}
                      aria-pressed={filtroRama === filter.value}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="panel-filter-group">
                <legend>Categoría</legend>
                <div className="panel-filter-segment" role="group" aria-label="Filtrar por categoría">
                  {CATEGORY_FILTERS.map((filter) => (
                    <button
                      type="button"
                      key={filter.value}
                      className={filtroCategoria === filter.value ? "active" : ""}
                      onClick={() =>
                        setFiltroCategoria((current) =>
                          current === filter.value ? "" : filter.value
                        )
                      }
                      disabled={cargandoElementos}
                      aria-pressed={filtroCategoria === filter.value}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              {filtrosActivos && (
                <button
                  type="button"
                  className="panel-clear-filters"
                  onClick={() => {
                    setFiltroRama("");
                    setFiltroCategoria("");
                  }}
                  disabled={cargandoElementos}
                >
                  Limpiar
                </button>
              )}
            </div>
          </div>

          {elementosError && (
            <StatusMessage variant="error">{elementosError}</StatusMessage>
          )}

          {cargandoElementos ? (
            <LoadingState compact label="Cargando elementos..." />
          ) : elementos.length === 0 && !elementosError ? (
            <EmptyState
              title="Sin elementos registrados"
              description="Cuando existan elementos activos aparecerán en esta lista."
            />
          ) : elementosFiltrados.length === 0 ? (
            <EmptyState
              title="Sin resultados"
              description="Ajusta los filtros para ver más elementos."
            />
          ) : (
            <div className="panel-elements__list" role="list">
              {elementosFiltrados.map((item) => (
                <button
                  type="button"
                  className="panel-element-row"
                  key={item.ID}
                  onClick={() => handleSeleccionar(item)}
                  role="listitem"
                >
                  <span className="panel-element-row__main">
                    <span className="panel-element-row__name">
                      {getElementName(item)}
                    </span>
                  </span>
                  <span className="panel-element-row__age">
                    {Number.isInteger(item?.edad) ? `${item.edad} años` : "Edad pendiente"}
                  </span>
                  <span className="panel-element-row__meta">
                    {getBasicInfo(item)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {seleccionado && (
        <div className="panel-detail">
          <section className="panel-card" aria-label="Expediente seleccionado">
            <div className="panel-selected">
              <button
                type="button"
                className="panel-back-button"
                onClick={handleVolverListado}
                disabled={cargando}
                aria-label="Volver a elementos"
              >
                <ArrowLeft aria-hidden="true" />
              </button>
              <strong>{getElementName(seleccionado)}</strong>
            </div>

            <nav className="panel-buttons" aria-label="Secciones del expediente">
              <button
                type="button"
                className={`panel-btn${modulo === "Informacion" ? " active" : ""}`}
                onClick={() => handleCargarModulo("Informacion")}
                disabled={cargando}
                aria-pressed={modulo === "Informacion"}
              >
                <FileText aria-hidden="true" /> Información
              </button>

              <button
                type="button"
                className={`panel-btn${modulo === "Pagos" ? " active" : ""}`}
                onClick={() => handleCargarModulo("Pagos")}
                disabled={cargando}
                aria-pressed={modulo === "Pagos"}
              >
                <CreditCard aria-hidden="true" /> Pagos
              </button>

              <button
                type="button"
                className={`panel-btn${modulo === "Asistencias" ? " active" : ""}`}
                onClick={() => handleCargarModulo("Asistencias")}
                disabled={cargando}
                aria-pressed={modulo === "Asistencias"}
              >
                <ClipboardCheck aria-hidden="true" /> Asistencias
              </button>
            </nav>
          </section>
        </div>
      )}

      {cargando && <LoadingState compact label="Cargando datos..." />}

      {seleccionado && (
        <div className="panel-detail panel-detail__module">
          {data && modulo === "Informacion" && (
            <ModuloInfo data={data} readOnly />
          )}

          {data && modulo === "Pagos" && (
            <ModuloPagos data={data} />
          )}

          {data && modulo === "Asistencias" && (
            <ModuloAsistencias data={data} />
          )}

          <div className="panel-danger-footer">
            <button
              type="button"
              className="panel-delete-button"
              onClick={abrirBaja}
              disabled={cargando}
            >
              <UserX aria-hidden="true" /> Dar de baja
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={bajaDialog.visible}
        title="Dar de baja elemento"
        message="Se cerrará la inscripción activa. El expediente y el historial se conservan para futuros reingresos."
        confirmLabel="Dar de baja"
        destructive
        busy={cargando}
        onConfirm={confirmarBaja}
        onCancel={cerrarBaja}
      >
        <label className="panel-drop-reason">
          Motivo de baja
          <textarea
            value={bajaDialog.reason}
            onChange={(event) =>
              setBajaDialog((current) => ({
                ...current,
                reason: event.target.value,
              }))
            }
            placeholder="Ej. Baja temporal, cambio de sede, decisión familiar..."
            rows={4}
            disabled={cargando}
          />
        </label>
      </ConfirmDialog>

      </div>
    </div>
  );
};

export default PanelAdmin;

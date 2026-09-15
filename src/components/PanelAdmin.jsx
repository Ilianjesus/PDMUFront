import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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
  ChevronRight,
  ClipboardCheck,
  CreditCard,
  FileText,
  RefreshCw,
  Search,
  SlidersHorizontal,
  UserX,
  UserPlus,
  X,
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
  const navigate = useNavigate();
  const { elementId = "", section = "informacion" } = useParams();
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef(null);
  const [bajaDialog, setBajaDialog] = useState({
    visible: false,
    reason: "",
  });

  useEffect(() => {
    if (!mensaje) return undefined;
    const timer = window.setTimeout(() => setMensaje(null), 4000);
    return () => window.clearTimeout(timer);
  }, [mensaje]);

  const mostrarMensaje = useCallback((texto, tipo = "success") => {
    setMensaje({ texto, tipo });
  }, []);

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
    if (!elementId) cargarElementos();
  }, [cargarElementos, elementId]);

  useEffect(() => {
    if (!filtersOpen) return undefined;

    const handlePointerDown = (event) => {
      if (!filtersRef.current?.contains(event.target)) setFiltersOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setFiltersOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [filtersOpen]);

  useEffect(() => {
    if (!seleccionado?.ID) return undefined;

    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [seleccionado?.ID]);

  const handleCargarModulo = useCallback(async (moduloSeleccionado, item) => {
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
      let resolvedItem = item;

      if (moduloSeleccionado !== "Informacion" && !item.displayName) {
        const profileResult = await getElement({
          elementId: item.ID,
          include: ["profile"],
        });
        if (!profileResult.ok) throw new Error(profileResult.message);
        resolvedItem = profileResult.data;
        setSeleccionado(resolvedItem);
      }

      const elementName =
        resolvedItem.displayName ||
        `${resolvedItem.Nombre ?? ""} ${resolvedItem.ApellidoPaterno ?? ""} ${resolvedItem.ApellidoMaterno ?? ""}`.trim();

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
        if (moduloSeleccionado === "Informacion") {
          setSeleccionado((current) => ({ ...current, ...responseData }));
        }
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
  }, [mostrarMensaje]);

  useEffect(() => {
    if (!elementId) {
      setSeleccionado(null);
      setModulo("");
      setData(null);
      return;
    }

    const moduleBySection = {
      informacion: "Informacion",
      pagos: "Pagos",
      asistencias: "Asistencias",
    };
    void handleCargarModulo(moduleBySection[section] || "Informacion", {
      ID: elementId,
    });
  }, [elementId, handleCargarModulo, section]);

  const handleSeleccionar = (item) => {
    navigate(`/elementos/${item.ID}/informacion`);
  };

  const handleVolverListado = () => {
    setSeleccionado(null);
    setModulo("");
    setData(null);
    setMensaje(null);
    setBajaDialog({ visible: false, reason: "" });
    navigate("/elementos");
  };

  const handleElementDataChange = useCallback((updatedElement) => {
    if (!updatedElement?.ID) return;

    setData(updatedElement);
    setSeleccionado((current) =>
      current?.ID === updatedElement.ID
        ? {
            ...current,
            ...updatedElement,
          }
        : current
    );
    setElementos((current) =>
      current.map((item) =>
        item.ID === updatedElement.ID
          ? {
              ...item,
              ...updatedElement,
            }
          : item
      )
    );
  }, []);

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
      navigate("/elementos");
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
    if (item?.Grupo) return item.Grupo;
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
  const activeFilterLabels = [
    BRANCH_FILTERS.find((filter) => filter.value === filtroRama)?.label,
    CATEGORY_FILTERS.find((filter) => filter.value === filtroCategoria)?.label,
  ].filter(Boolean);
  const filterSummary = activeFilterLabels.join(" · ");
  const directoryCountLabel = cargandoElementos
    ? "Cargando elementos"
    : filtrosActivos
    ? `${elementosFiltrados.length} de ${elementos.length} activos`
    : `${elementos.length} activos`;

  return (
    <div className="panel-container page-shell">
      <div className="page-shell__inner">
        <PageHeader
          title={seleccionado ? "Elemento" : "Elementos"}
          description={
            seleccionado
              ? getElementName(seleccionado)
              : "Busca, filtra y abre expedientes activos."
          }
          infoTooltip={
            seleccionado
              ? "Expediente individual del elemento seleccionado."
              : "Consulta elementos, información básica, pagos y asistencias."
          }
          onBack={seleccionado ? handleVolverListado : undefined}
          backLabel="Volver a elementos"
          actions={
            !seleccionado ? (
              <Link className="ui-button page-header__primary-link" to="/elementos/nuevo">
                <UserPlus aria-hidden="true" />
                <span>Nueva inscripción</span>
              </Link>
            ) : undefined
          }
          menuActions={
            !seleccionado
              ? [
                  {
                    id: "elements-refresh",
                    label: cargandoElementos ? "Actualizando" : "Actualizar",
                    icon: RefreshCw,
                    onSelect: cargarElementos,
                    disabled: cargandoElementos,
                  },
                ]
              : []
          }
        />

      {mensaje && (
        <StatusMessage variant={mensaje.tipo}>
          {mensaje.texto}
        </StatusMessage>
      )}

      {!seleccionado && (
        <div className="panel-directory-workspace">
          <section
            className="panel-controls-surface"
            aria-label="Buscar y filtrar elementos"
            ref={filtersRef}
          >
            <div className="panel-search-toolbar">
              <div className="panel-search__field">
                <Search aria-hidden="true" />
                <Buscador
                  placeholder="Buscar"
                  ariaLabel="Buscar elemento"
                  onSeleccionar={handleSeleccionar}
                />
              </div>

              <button
                type="button"
                className={`panel-filter-trigger${filtrosActivos ? " is-active" : ""}`}
                onClick={() => setFiltersOpen((current) => !current)}
                aria-expanded={filtersOpen}
                aria-controls="element-filters"
                aria-haspopup="true"
                aria-label={
                  filtrosActivos
                    ? `Filtros activos: ${filterSummary}`
                    : "Abrir filtros"
                }
                title={filterSummary || "Filtros"}
              >
                <SlidersHorizontal aria-hidden="true" />
                <span>Filtros</span>
                {activeFilterLabels.length > 0 && (
                  <strong aria-hidden="true">{activeFilterLabels.length}</strong>
                )}
              </button>
            </div>

            {filtersOpen && (
              <div
                className="panel-filter-popover"
                id="element-filters"
                role="region"
                aria-label="Filtros de elementos"
              >
                <div className="panel-filter-popover__header">
                  <strong>Filtros</strong>
                  <div>
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
                        Restablecer
                      </button>
                    )}
                    <button
                      type="button"
                      className="panel-filter-close"
                      onClick={() => setFiltersOpen(false)}
                      aria-label="Cerrar filtros"
                      title="Cerrar filtros"
                    >
                      <X aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="panel-filters">
                  <fieldset className="panel-filter-group">
                    <legend>Rama</legend>
                    <div className="panel-filter-segment" role="group" aria-label="Filtrar por rama">
                      <button
                        type="button"
                        className={!filtroRama ? "active" : ""}
                        onClick={() => setFiltroRama("")}
                        disabled={cargandoElementos}
                        aria-pressed={!filtroRama}
                      >
                        Todas
                      </button>
                      {BRANCH_FILTERS.map((filter) => (
                        <button
                          type="button"
                          key={filter.value}
                          className={filtroRama === filter.value ? "active" : ""}
                          onClick={() => setFiltroRama(filter.value)}
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
                      <button
                        type="button"
                        className={!filtroCategoria ? "active" : ""}
                        onClick={() => setFiltroCategoria("")}
                        disabled={cargandoElementos}
                        aria-pressed={!filtroCategoria}
                      >
                        Todas
                      </button>
                      {CATEGORY_FILTERS.map((filter) => (
                        <button
                          type="button"
                          key={filter.value}
                          className={filtroCategoria === filter.value ? "active" : ""}
                          onClick={() => setFiltroCategoria(filter.value)}
                          disabled={cargandoElementos}
                          aria-pressed={filtroCategoria === filter.value}
                        >
                          {filter.label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                </div>
              </div>
            )}
          </section>

          <section className="panel-list-surface" aria-labelledby="elements-list-title">
            <div className="panel-list-surface__header">
              <h2 id="elements-list-title">Elementos activos</h2>
              <strong>{directoryCountLabel}</strong>
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
                  <div role="listitem" key={item.ID}>
                    <button
                      type="button"
                      className="panel-element-row"
                      onClick={() => handleSeleccionar(item)}
                    >
                      <span className="panel-element-row__main">
                        <span className="panel-element-row__name">
                          {getElementName(item)}
                        </span>
                        <span className="panel-element-row__details">
                          <span className="panel-element-row__age">
                            {Number.isInteger(item?.edad) ? `${item.edad} años` : "Edad pendiente"}
                          </span>
                          <span className="panel-element-row__meta">
                            {getBasicInfo(item)}
                          </span>
                        </span>
                      </span>
                      <ChevronRight className="panel-element-row__arrow" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {seleccionado && (
        <div className="panel-detail">
          <section className="panel-card" aria-label="Expediente seleccionado">
            <nav className="panel-buttons" aria-label="Secciones del expediente">
              <button
                type="button"
                className={`panel-btn${modulo === "Informacion" ? " active" : ""}`}
                onClick={() => navigate(`/elementos/${seleccionado.ID}/informacion`)}
                disabled={cargando}
                aria-pressed={modulo === "Informacion"}
              >
                <FileText aria-hidden="true" /> Información
              </button>

              <button
                type="button"
                className={`panel-btn${modulo === "Pagos" ? " active" : ""}`}
                onClick={() => navigate(`/elementos/${seleccionado.ID}/pagos`)}
                disabled={cargando}
                aria-pressed={modulo === "Pagos"}
              >
                <CreditCard aria-hidden="true" /> Pagos
              </button>

              <button
                type="button"
                className={`panel-btn${modulo === "Asistencias" ? " active" : ""}`}
                onClick={() => navigate(`/elementos/${seleccionado.ID}/asistencias`)}
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
            <ModuloInfo data={data} onDataChange={handleElementDataChange} />
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

import { useState } from "react";
import axios from "axios";
import Buscador from "../components/Buscador";
import ModuloInfo from "../components/ModuloInfo";
import ModuloPagos from "../components/ModuloPagos";
import ModuloAsistencias from "../components/ModuloAsistencias";

import "../styles/PanelAdmin.css";

const PanelAdmin = () => {
  const [seleccionado, setSeleccionado] = useState(null);
  const [modulo, setModulo] = useState("");
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  const normalizeWebhookResponse = (raw) => {
    if (Array.isArray(raw) && raw.length > 0) {
      return raw[0]?.json ?? raw[0];
    }
    if (raw?.json) return raw.json;
    if (typeof raw === "object" && raw !== null) return raw;
    return null;
  };

  const mostrarMensaje = (texto, tipo = "success") => {
    setMensaje({ texto, tipo });
    setTimeout(() => setMensaje(null), 3000);
  };

  const handleSeleccionar = (item) => {
    setSeleccionado(item);
    setModulo("");
    setData(null);
  };

  const getSheetByModulo = (moduloNombre) => {
    const sheetMap = {
      Informacion: "elementos",
      Pagos: "Pagos",
      Asistencias: "Asistencias",
    };

    return sheetMap[moduloNombre] || moduloNombre;
  };

  const handleCargarModulo = async (moduloSeleccionado) => {
    if (!seleccionado?.ID) {
      mostrarMensaje("Selecciona un elemento primero", "error");
      return;
    }

    setModulo(moduloSeleccionado);
    setCargando(true);

    try {
      const url = import.meta.env.VITE_N8N_WEBHOOK_ADMIN;
      const sheet = getSheetByModulo(moduloSeleccionado);

      const payload = {
        sheet,
        operacion: "leer",
        ID: seleccionado.ID,
      };

      const res = await axios.post(url, payload);
      const responseData = normalizeWebhookResponse(res.data);

      if (!res?.status || res.status < 200 || res.status >= 300) {
        throw new Error("Respuesta HTTP inválida");
      }

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

  const handleOperacion = async (tipo, payload) => {
    try {
      const url = import.meta.env.VITE_N8N_WEBHOOK_ADMIN;
      const sheet = getSheetByModulo(modulo);

      const body = {
        sheet,
        operacion: tipo,
        datos: payload,
      };

      const res = await axios.post(url, body);
      const result = normalizeWebhookResponse(res.data);

      if (!res?.status || res.status < 200 || res.status >= 300) {
        throw new Error("Respuesta HTTP inválida");
      }

      if (result?.status && result.status !== "success") {
        throw new Error(
          result?.message || `No se pudo realizar la operación ${tipo}`
        );
      }

      mostrarMensaje(
        result?.message || `Operación ${tipo} realizada con éxito`
      );

      await handleCargarModulo(modulo);
    } catch (error) {
      console.error(error);
      mostrarMensaje(
        error?.response?.data?.message ||
          error?.message ||
          "Error al realizar operación",
        "error"
      );
    }
  };

  const handleEliminarElemento = async () => {
    if (!seleccionado?.ID || eliminando) return;

    const confirmado = window.confirm(
      `¿Seguro que deseas eliminar a ${seleccionado.Nombre || "este elemento"} (${seleccionado.ID})? Esta acción no se puede deshacer.`
    );

    if (!confirmado) return;

    try {
      setEliminando(true);

      const url = import.meta.env.VITE_N8N_WEBHOOK_ADMIN;

      const body = {
        sheet: "elementos",
        operacion: "delete",
        ID: seleccionado.ID,
      };

      const res = await axios.post(url, body);
      const result = normalizeWebhookResponse(res.data);

      if (!res?.status || res.status < 200 || res.status >= 300) {
        throw new Error("Respuesta HTTP inválida");
      }

      if (!result || result.status !== "success") {
        throw new Error(
          result?.message || "No se pudo eliminar el elemento"
        );
      }

      mostrarMensaje(
        result.message || "Elemento eliminado correctamente",
        "success"
      );

      setSeleccionado(null);
      setModulo("");
      setData(null);
    } catch (error) {
      console.error(error);
      mostrarMensaje(
        error?.response?.data?.message ||
          error?.message ||
          "Error al eliminar el elemento",
        "error"
      );
    } finally {
      setEliminando(false);
    }
  };

  return (
    <div className="panel-container">
      <h2 className="panel-title">Panel de Administración</h2>

      {mensaje && (
        <div className={`panel-message ${mensaje.tipo}`}>
          {mensaje.texto}
        </div>
      )}

      {!seleccionado && (
        <Buscador
          placeholder="Buscar por nombre o ID"
          onSeleccionar={handleSeleccionar}
        />
      )}

      {seleccionado && (
        <div className="panel-card">
          <p className="panel-selected">
            <strong>Seleccionado:</strong>{" "}
            {seleccionado.Nombre} ({seleccionado.ID})
          </p>

          <div className="panel-buttons">
            <button
              className="panel-btn"
              onClick={() => handleCargarModulo("Informacion")}
              disabled={cargando || eliminando}
            >
              Información Personal
            </button>

            <button
              className="panel-btn"
              onClick={() => handleCargarModulo("Pagos")}
              disabled={cargando || eliminando}
            >
              Pagos
            </button>

            <button
              className="panel-btn"
              onClick={() => handleCargarModulo("Asistencias")}
              disabled={cargando || eliminando}
            >
              Asistencias
            </button>

            <button
              className="panel-btn panel-btn-danger"
              onClick={handleEliminarElemento}
              disabled={cargando || eliminando}
            >
              {eliminando ? "Eliminando..." : "Eliminar elemento"}
            </button>
          </div>
        </div>
      )}

      {cargando && <p className="panel-loading">Cargando datos...</p>}

      {data && modulo === "Informacion" && (
        <ModuloInfo data={data} onOperacion={handleOperacion} />
      )}

      {data && modulo === "Pagos" && (
        <ModuloPagos data={data} onOperacion={handleOperacion} />
      )}

      {data && modulo === "Asistencias" && (
        <ModuloAsistencias data={data} onOperacion={handleOperacion} />
      )}
    </div>
  );
};

export default PanelAdmin;
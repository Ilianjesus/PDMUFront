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
  const [mensaje, setMensaje] = useState(null);

  const normalizeWebhookResponse = (raw) => {
    if (Array.isArray(raw) && raw.length > 0) {
      return raw[0]?.json ?? raw[0];
    }
    if (raw?.json) return raw.json;
    if (typeof raw === "object") return raw;
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

  const handleCargarModulo = async (moduloSeleccionado) => {
    if (!seleccionado?.ID) {
      mostrarMensaje("Selecciona un elemento primero", "error");
      return;
    }

    setModulo(moduloSeleccionado);
    setCargando(true);

    try {
      const url = import.meta.env.VITE_N8N_WEBHOOK_ADMIN;
      const payload = {
        sheet: moduloSeleccionado,
        operacion: "leer",
        ID: seleccionado.ID,
      };

      const res = await axios.post(url, payload);
      const responseData = normalizeWebhookResponse(res.data);

      if (!responseData || Object.keys(responseData).length === 0) {
        mostrarMensaje("No se encontraron datos para este módulo", "error");
        setData(null);
      } else {
        setData(responseData);
      }
    } catch (error) {
      console.error(error);
      mostrarMensaje("Error al cargar datos", "error");
      setData(null);
    } finally {
      setCargando(false);
    }
  };

  const handleOperacion = async (tipo, payload) => {
    try {
      const url = import.meta.env.VITE_N8N_WEBHOOK_ADMIN;

      const body = {
        sheet: modulo,
        operacion: tipo,
        datos: payload,
      };

      const res = await axios.post(url, body);

      mostrarMensaje(
        res.data?.message || `Operación ${tipo} realizada con éxito`
      );

      // 🔁 REFRESCAR módulo actual automáticamente
      await handleCargarModulo(modulo);

    } catch (error) {
      console.error(error);
      mostrarMensaje("Error al realizar operación", "error");
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
            >
              Información Personal
            </button>

            <button
              className="panel-btn"
              onClick={() => handleCargarModulo("Pagos")}
            >
              Pagos
            </button>

            <button
              className="panel-btn"
              onClick={() => handleCargarModulo("Asistencias")}
            >
              Asistencias
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
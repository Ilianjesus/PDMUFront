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

  const handleSeleccionar = (item) => {
    setSeleccionado(item);
    setModulo("");
    setData(null);
  };

  const handleCargarModulo = async (moduloSeleccionado) => {
    if (!seleccionado?.ID) {
      alert("Selecciona un elemento primero");
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
      console.log("📡 Respuesta completa del webhook:", res);

      let responseData = null;

      if (Array.isArray(res.data) && res.data.length > 0) {
        responseData = res.data[0].json ? res.data[0].json : res.data[0];
      } else if (res.data?.json) {
        responseData = res.data.json;
      } else if (typeof res.data === "object") {
        responseData = res.data;
      }

      if (!responseData || Object.keys(responseData).length === 0) {
        alert("❌ No se encontraron datos para este módulo");
        setData(null);
      } else {
        setData(responseData);
      }
    } catch (error) {
      console.error("Error al obtener datos:", error);
      alert("❌ No se pudieron cargar los datos");
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

      alert(`✅ ${res.data?.message || `Operación ${tipo} realizada con éxito`}`);

      setSeleccionado(null);
      setModulo("");
      setData(null);
    } catch (error) {
      console.error(error);
      alert("❌ Error al realizar operación");
    }
  };

  return (
    <div className="panel-container">
      <h2 className="panel-title">Panel de Administración</h2>

      {!seleccionado && (
        <Buscador
          placeholder="Buscar por nombre o ID"
          onSeleccionar={handleSeleccionar}
        />
      )}

      {seleccionado && (
        <div className="panel-card">
          <p className="panel-selected">
            <strong>Seleccionado:</strong> {seleccionado.Nombre} ({seleccionado.ID})
          </p>

          <div className="panel-buttons">
            <button className="panel-btn" onClick={() => handleCargarModulo("Informacion")}>
              Información Personal
            </button>

            <button className="panel-btn" onClick={() => handleCargarModulo("Pagos")}>
              Pagos
            </button>

            <button className="panel-btn" onClick={() => handleCargarModulo("Asistencias")}>
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

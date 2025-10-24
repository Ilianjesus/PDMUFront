import { useState } from "react";
import axios from "axios";
import Buscador from "../components/Buscador";
import ModuloInfo from "../components/ModuloInfo";
import ModuloPagos from "../components/ModuloPagos";
import ModuloAsistencias from "../components/ModuloAsistencias";

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
      console.log("📡 Respuesta data:", res.data);

      let responseData = null;

      // 🔹 Manejo flexible de la respuesta
      if (Array.isArray(res.data) && res.data.length > 0) {
        // Si es array, tomamos el primer elemento
        responseData = res.data[0].json ? res.data[0].json : res.data[0];
      } else if (res.data && res.data.json) {
        // Si es objeto con { json: ... } estilo n8n
        responseData = res.data.json;
      } else if (res.data && typeof res.data === "object") {
        // Si es objeto plano
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

      if (res.data?.message) {
        alert(`✅ ${res.data.message}`);
      } else {
        alert(`✅ Operación ${tipo} realizada con éxito`);
      }

      setSeleccionado(null);
      setModulo("");
      setData(null);
    } catch (error) {
      console.error(error);
      alert("❌ Error al realizar operación");
    }
  };

  return (
    <div style={{ padding: "20px" }}>
      <h2>Panel de Administración</h2>

      {!seleccionado && (
        <Buscador
          placeholder="Buscar por nombre o ID"
          onSeleccionar={handleSeleccionar}
        />
      )}

      {seleccionado && (
        <div style={{ marginTop: "20px" }}>
          <p>
            <strong>Seleccionado:</strong> {seleccionado.Nombre} ({seleccionado.ID})
          </p>

          <div>
            <button onClick={() => handleCargarModulo("Informacion")}>🧍 Información</button>
            <button onClick={() => handleCargarModulo("Pagos")}>💰 Pagos</button>
            <button onClick={() => handleCargarModulo("Asistencias")}>📅 Asistencias</button>
          </div>
        </div>
      )}

      {cargando && <p>Cargando datos...</p>}

      {data && modulo === "Informacion" && <ModuloInfo data={data} onOperacion={handleOperacion} />}
      {data && modulo === "Pagos" && <ModuloPagos data={data} onOperacion={handleOperacion} />}
      {data && modulo === "Asistencias" && <ModuloAsistencias data={data} onOperacion={handleOperacion} />}
    </div>
  );
};

export default PanelAdmin;

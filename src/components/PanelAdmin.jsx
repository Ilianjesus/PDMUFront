import { useState } from "react";
import axios from "axios";
import Buscador from "../components/Buscador";
import ModuloInfo from "../components/ModuloInfo";

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
    if (!seleccionado?.ID) return alert("Selecciona un elemento primero");
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
      setData(res.data[0]);
    } catch (error) {
      console.error("Error al obtener datos:", error);
      alert("❌ No se pudieron cargar los datos");
    } finally {
      setCargando(false);
    }
  };

  // ✅ Muestra el mensaje devuelto por el workflow antes de resetear el estado
  const handleOperacion = async (tipo, payload) => {
    try {
      const url = import.meta.env.VITE_N8N_WEBHOOK_ADMIN;
      const body = {
        sheet: modulo,
        operacion: tipo,
        datos: payload,
      };

      const res = await axios.post(url, body);

      // Mostrar mensaje del workflow (res.data.message)
      if (res.data?.message) {
        alert(`✅ ${res.data.message}`);
      } else {
        alert(`✅ Operación ${tipo} realizada con éxito`);
      }

      // 🔄 Regresar al estado inicial después de mostrar el mensaje
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

      {/* 1️⃣ BUSCADOR */}
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

          {/* 2️⃣ SELECCIÓN DE MÓDULO */}
          <div>
            <button onClick={() => handleCargarModulo("Informacion")}>
              🧍 Información
            </button>
            <button onClick={() => handleCargarModulo("Pagos")}>
              💰 Pagos
            </button>
            <button onClick={() => handleCargarModulo("Asistencias")}>
              📅 Asistencias
            </button>
          </div>
        </div>
      )}

      {/* 3️⃣ MÓDULO CARGADO */}
      {cargando && <p>Cargando datos...</p>}

      {data && modulo === "Informacion" && (
        <ModuloInfo data={data} onOperacion={handleOperacion} />
      )}
    </div>
  );
};

export default PanelAdmin;

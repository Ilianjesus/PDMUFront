import { useState, useEffect } from "react";

const ModuloAsistencias = ({ data, onOperacion }) => {
  const [asistencias, setAsistencias] = useState([]);

  // Función para convertir "DD/MM/YYYY HH:mm:ss" a formato ISO compatible con JS
  const parseFechaHora = (str) => {
    if (!str) return new Date(""); // fallback
    const [fecha, hora] = str.split(" ");
    if (!fecha || !hora) return new Date("");
    const [dd, mm, yyyy] = fecha.split("/");
    return new Date(`${yyyy}-${mm}-${dd}T${hora}`);
  };

  useEffect(() => {
    console.log("📦 Data recibida en ModuloAsistencias:", data);
    if (data?.Asistencias && Array.isArray(data.Asistencias)) {
      const ordenadas = [...data.Asistencias].sort(
        (a, b) => parseFechaHora(a.FechaHora) - parseFechaHora(b.FechaHora)
      );
      setAsistencias(ordenadas);
    }
  }, [data]);

  // Cambiar el estado (Asistencia, Falta, etc.)
  const handleEditarEstado = (index, nuevoEstado) => {
    const actualizadas = [...asistencias];
    actualizadas[index].Estado = nuevoEstado;
    setAsistencias(actualizadas);
  };

  // Guardar los cambios (editar)
  const handleGuardarCambios = (index) => {
    const registro = asistencias[index];
    onOperacion("editar", {
      "ID Elemento": data["ID Elemento"],
      row_number: registro.row_number,
      Estado: registro.Estado,
      Tipo: registro.Tipo,
    });
  };

  // Eliminar asistencia
  const handleEliminar = (registro) => {
    if (confirm("¿Eliminar esta asistencia?")) {
      onOperacion("eliminar", {
        "ID Elemento": data["ID Elemento"],
        row_number: registro.row_number,
      });
    }
  };

  if (!asistencias.length) {
    return (
      <div style={{ marginTop: "20px" }}>
        <h4>📅 Historial de Asistencias</h4>
        <p>No se encontraron asistencias registradas.</p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: "20px" }}>
      <h4>📅 Historial de Asistencias</h4>
      <p>
        <strong>Alumno:</strong> {data["Nombre Elemento"]} <br />
        <strong>ID:</strong> {data["ID Elemento"]}
      </p>

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          marginTop: "10px",
          fontSize: "14px",
        }}
      >
        <thead style={{ backgroundColor: "#f2f2f2" }}>
          <tr>
            <th style={th}>Fecha y Hora</th>
            <th style={th}>Estado</th>
            <th style={th}>Tipo</th>
            <th style={th}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {asistencias.map((asis, index) => (
            <tr key={index}>
              <td style={td}>{asis.FechaHora}</td>
              <td style={td}>
                <select
                  value={asis.Estado}
                  onChange={(e) => handleEditarEstado(index, e.target.value)}
                >
                  <option>Asistencia</option>
                  <option>Falta</option>
                  <option>Retardo</option>
                  <option>Justificada</option>
                </select>
              </td>
              <td style={td}>{asis.Tipo}</td>
              <td style={td}>
                <button onClick={() => handleGuardarCambios(index)} style={btnGuardar}>
                  💾 Guardar
                </button>
                <button onClick={() => handleEliminar(asis)} style={btnEliminar}>
                  🗑 Eliminar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// 🔹 Estilos básicos
const th = { border: "1px solid #ddd", padding: "8px", textAlign: "left" };
const td = { border: "1px solid #ddd", padding: "8px" };
const btnGuardar = {
  backgroundColor: "#4CAF50",
  color: "white",
  border: "none",
  padding: "4px 8px",
  marginRight: "5px",
  borderRadius: "4px",
  cursor: "pointer",
};
const btnEliminar = {
  backgroundColor: "#ff4d4d",
  color: "white",
  border: "none",
  padding: "4px 8px",
  borderRadius: "4px",
  cursor: "pointer",
};

export default ModuloAsistencias;

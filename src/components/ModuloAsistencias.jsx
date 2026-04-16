import { useState, useEffect } from "react";
import axios from "axios";

const ModuloAsistencias = ({ data }) => {
  const [asistencias, setAsistencias] = useState([]);
  const [savingRow, setSavingRow] = useState(null);
  const [deletingRow, setDeletingRow] = useState(null);

  const parseFechaHora = (str) => {
    if (!str) return new Date("");
    const [fecha, hora] = str.split(" ");
    if (!fecha || !hora) return new Date("");
    const [dd, mm, yyyy] = fecha.split("/");
    return new Date(`${yyyy}-${mm}-${dd}T${hora}`);
  };

  useEffect(() => {
    if (data?.Asistencias && Array.isArray(data.Asistencias)) {
      const ordenadas = [...data.Asistencias].sort(
        (a, b) => parseFechaHora(a.FechaHora) - parseFechaHora(b.FechaHora)
      );
      setAsistencias(ordenadas);
    } else {
      setAsistencias([]);
    }
  }, [data]);

  const handleEditarEstado = (index, nuevoEstado) => {
    const actualizadas = [...asistencias];
    actualizadas[index] = {
      ...actualizadas[index],
      Estado: nuevoEstado,
    };
    setAsistencias(actualizadas);
  };

  const handleGuardarCambios = async (index) => {
    const registro = asistencias[index];

    try {
      setSavingRow(registro.row_number);

      const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_ADMIN;

      if (!webhookUrl) {
        throw new Error("Falta la variable VITE_N8N_WEBHOOK_ADMIN");
      }

      const payload = {
        sheet: "Asistencias",
        operacion: "update",
        ID: data["ID Elemento"],
        datos: {
          row_number: registro.row_number,
          Estado: registro.Estado,
          Tipo: registro.Tipo,
          FechaHora: registro.FechaHora,
        },
      };

      const res = await axios.post(webhookUrl, payload);
      const result = res?.data;

      if (!res?.status || res.status < 200 || res.status >= 300) {
        throw new Error("Respuesta HTTP inválida");
      }

      if (!result || result.status !== "success") {
        throw new Error(
          result?.message || "No se pudo actualizar la asistencia"
        );
      }

      alert(result.message || "Asistencia actualizada correctamente");
    } catch (err) {
      console.error("Error actualizando asistencia:", err);
      alert(
        err?.response?.data?.message ||
          err?.message ||
          "Error al actualizar la asistencia"
      );
    } finally {
      setSavingRow(null);
    }
  };

  const handleEliminar = async (registro) => {
    const confirmado = window.confirm("¿Eliminar esta asistencia?");
    if (!confirmado) return;

    try {
      setDeletingRow(registro.row_number);

      const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_ADMIN;

      if (!webhookUrl) {
        throw new Error("Falta la variable VITE_N8N_WEBHOOK_ADMIN");
      }

      const payload = {
        sheet: "Asistencias",
        operacion: "delete",
        ID: data["ID Elemento"],
        datos: {
          row_number: registro.row_number,
        },
      };

      const res = await axios.post(webhookUrl, payload);
      const result = res?.data;

      if (!res?.status || res.status < 200 || res.status >= 300) {
        throw new Error("Respuesta HTTP inválida");
      }

      if (!result || result.status !== "success") {
        throw new Error(
          result?.message || "No se pudo eliminar la asistencia"
        );
      }

      setAsistencias((prev) =>
        prev.filter((item) => item.row_number !== registro.row_number)
      );

      alert(result.message || "Asistencia eliminada correctamente");
    } catch (err) {
      console.error("Error eliminando asistencia:", err);
      alert(
        err?.response?.data?.message ||
          err?.message ||
          "Error al eliminar la asistencia"
      );
    } finally {
      setDeletingRow(null);
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
          {asistencias.map((asis, index) => {
            const isSaving = savingRow === asis.row_number;
            const isDeleting = deletingRow === asis.row_number;
            const isBusy = isSaving || isDeleting;

            return (
              <tr key={asis.row_number ?? index}>
                <td style={td}>{asis.FechaHora}</td>
                <td style={td}>
                  <select
                    value={asis.Estado}
                    onChange={(e) => handleEditarEstado(index, e.target.value)}
                    disabled={isBusy}
                  >
                    <option value="Asistencia">Asistencia</option>
                    <option value="Falta">Falta</option>
                    <option value="Retardo">Retardo</option>
                    <option value="Justificada">Justificada</option>
                  </select>
                </td>
                <td style={td}>{asis.Tipo}</td>
                <td style={td}>
                  <button
                    onClick={() => handleGuardarCambios(index)}
                    style={btnGuardar}
                    disabled={isBusy}
                  >
                    {isSaving ? "Guardando..." : "💾 Guardar"}
                  </button>
                  <button
                    onClick={() => handleEliminar(asis)}
                    style={btnEliminar}
                    disabled={isBusy}
                  >
                    {isDeleting ? "Eliminando..." : "🗑 Eliminar"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

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
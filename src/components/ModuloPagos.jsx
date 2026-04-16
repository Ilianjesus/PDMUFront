import { useState, useEffect } from "react";
import axios from "axios";
import "../styles/ModuloPagos.css";

const ModuloPagos = ({ data }) => {
  const [pagos, setPagos] = useState([]);
  const [editIndex, setEditIndex] = useState(null);
  const [editData, setEditData] = useState({});
  const [expanded, setExpanded] = useState({});
  const [dialog, setDialog] = useState({
    visible: false,
    tipo: "",
    index: null,
    payload: null,
  });
  const [savingRow, setSavingRow] = useState(null);
  const [deletingRow, setDeletingRow] = useState(null);

  const añoActual = new Date().getFullYear();

  const meses = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];

  useEffect(() => {
    if (data?.pagos && Array.isArray(data.pagos)) {
      const filtrados = data.pagos.filter((p) => p.Año === añoActual);

      const pagosPorMes = meses.map((mes) => {
        const pagoMes = filtrados.find((p) => p.Mes === mes);
        return {
          Mes: mes,
          Cantidad: pagoMes?.Cantidad || 0,
          Pagado: !!pagoMes,
          ...pagoMes,
        };
      });

      setPagos(pagosPorMes);
    } else {
      setPagos([]);
    }
  }, [data, añoActual]);

  const mostrarDialogo = (tipo, index, payload = null) => {
    setDialog({
      visible: true,
      tipo,
      index,
      payload,
    });
  };

  const cerrarDialogo = () => {
    if (savingRow || deletingRow) return;

    setDialog({
      visible: false,
      tipo: "",
      index: null,
      payload: null,
    });
  };

  const toggleExpand = (index) => {
    setExpanded((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const handleEdit = (index) => {
    if (savingRow || deletingRow) return;
    setEditIndex(index);
    setEditData({ ...pagos[index] });
  };

  const handleChange = (e) => {
    setEditData({ ...editData, [e.target.name]: e.target.value });
  };

  const handleConfirmarGuardar = async () => {
    try {
      const rowNumber = editData.row_number;
      setSavingRow(rowNumber);

      const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_ADMIN;

      if (!webhookUrl) {
        throw new Error("Falta la variable VITE_N8N_WEBHOOK_ADMIN");
      }

      const payload = {
        sheet: "Pagos",
        operacion: "update",
        ID: data["ID Elemento"],
        datos: {
          row_number: editData.row_number,
          "ID Pago": editData["ID Pago"],
          Mes: editData.Mes,
          Año: añoActual,
          Cantidad: editData.Cantidad,
          "Tipo de Pago": editData["Tipo de Pago"],
        },
      };

      const res = await axios.post(webhookUrl, payload);
      const result = res?.data;

      if (!res?.status || res.status < 200 || res.status >= 300) {
        throw new Error("Respuesta HTTP inválida");
      }

      if (!result || result.status !== "success") {
        throw new Error(result?.message || "No se pudo actualizar el pago");
      }

      setPagos((prev) =>
        prev.map((pago, index) =>
          index === editIndex
            ? {
                ...pago,
                ...editData,
                Año: añoActual,
                Pagado: true,
              }
            : pago
        )
      );

      setEditIndex(null);
      setEditData({});
      cerrarDialogo();

      alert(result.message || "Pago actualizado correctamente");
    } catch (err) {
      console.error("Error actualizando pago:", err);
      alert(
        err?.response?.data?.message ||
          err?.message ||
          "Error al actualizar el pago"
      );
    } finally {
      setSavingRow(null);
    }
  };

  const handleConfirmarEliminar = async () => {
    try {
      const rowNumber = dialog.payload?.row_number;
      setDeletingRow(rowNumber);

      const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_ADMIN;

      if (!webhookUrl) {
        throw new Error("Falta la variable VITE_N8N_WEBHOOK_ADMIN");
      }

      const payload = {
        sheet: "Pagos",
        operacion: "delete",
        ID: data["ID Elemento"],
        datos: {
          row_number: dialog.payload.row_number,
          "ID Pago": dialog.payload["ID Pago"],
        },
      };

      const res = await axios.post(webhookUrl, payload);
      const result = res?.data;

      if (!res?.status || res.status < 200 || res.status >= 300) {
        throw new Error("Respuesta HTTP inválida");
      }

      if (!result || result.status !== "success") {
        throw new Error(result?.message || "No se pudo eliminar el pago");
      }

      setPagos((prev) =>
        prev.map((pago) =>
          pago.row_number === dialog.payload.row_number
            ? {
                Mes: pago.Mes,
                Cantidad: 0,
                Pagado: false,
              }
            : pago
        )
      );

      cerrarDialogo();

      alert(result.message || "Pago eliminado correctamente");
    } catch (err) {
      console.error("Error eliminando pago:", err);
      alert(
        err?.response?.data?.message ||
          err?.message ||
          "Error al eliminar el pago"
      );
    } finally {
      setDeletingRow(null);
    }
  };

  const confirmarAccion = async () => {
    if (dialog.tipo === "eliminar") {
      await handleConfirmarEliminar();
      return;
    }

    if (dialog.tipo === "guardar") {
      await handleConfirmarGuardar();
    }
  };

  const textoDialogo =
    dialog.tipo === "eliminar"
      ? "¿Seguro que deseas eliminar este pago?"
      : dialog.tipo === "guardar"
      ? "¿Guardar los cambios en este pago?"
      : "";

  return (
    <div className="pagos-container">
      <h3 className="pagos-titulo">Pagos del Año</h3>

      <p className="pagos-alumno">
        <strong>Alumno:</strong> {data["Nombre Elemento"]} <br />
        <strong>ID:</strong> {data["ID Elemento"]} <br />
        <strong>Año:</strong> {añoActual}
      </p>

      <div className="pagos-columna">
        {pagos.map((pago, index) => {
          const isSaving = savingRow === pago.row_number;
          const isDeleting = deletingRow === pago.row_number;
          const isBusy = isSaving || isDeleting;

          return (
            <div
              className={`pago-card ${pago.Pagado ? "pago-ok" : "pago-pendiente"}`}
              key={pago.row_number ?? index}
            >
              <div
                className={`expand-arrow ${expanded[index] ? "open" : ""}`}
                onClick={() => !isBusy && toggleExpand(index)}
              >
                ▼
              </div>

              {editIndex === index ? (
                <div className="pago-edit">
                  <select
                    name="Mes"
                    value={editData.Mes || ""}
                    onChange={handleChange}
                    disabled={isBusy}
                  >
                    {meses.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>

                  <input
                    type="number"
                    name="Cantidad"
                    value={editData.Cantidad ?? ""}
                    onChange={handleChange}
                    placeholder="Cantidad"
                    disabled={isBusy}
                  />

                  <select
                    name="Tipo de Pago"
                    value={editData["Tipo de Pago"] || "Efectivo"}
                    onChange={handleChange}
                    disabled={isBusy}
                  >
                    <option value="Efectivo">Efectivo</option>
                    <option value="Transferencia">Transferencia</option>
                  </select>

                  <div className="pago-btns">
                    <button
                      className="btn-guardar"
                      onClick={() => mostrarDialogo("guardar", editIndex)}
                      disabled={isBusy}
                    >
                      {isSaving ? "Guardando..." : "Guardar"}
                    </button>
                    <button
                      className="btn-cancelar"
                      onClick={() => {
                        if (isBusy) return;
                        setEditIndex(null);
                        setEditData({});
                      }}
                      disabled={isBusy}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <h4 className="pago-mes">{pago.Mes}</h4>

                  <p className="pago-cantidad">
                    Cantidad: <strong>${pago.Cantidad}</strong>
                  </p>

                  <p className="pago-estado">
                    Estado:{" "}
                    <strong className={pago.Pagado ? "ok" : "pendiente"}>
                      {pago.Pagado ? "Pagado" : "Por pagar"}
                    </strong>
                  </p>

                  {expanded[index] && pago.Pagado && (
                    <div className="pago-btns">
                      <button
                        className="btn-editar"
                        onClick={() => handleEdit(index)}
                        disabled={isBusy}
                      >
                        Editar
                      </button>

                      <button
                        className="btn-eliminar"
                        onClick={() =>
                          mostrarDialogo("eliminar", index, {
                            "ID Pago": pago["ID Pago"],
                            row_number: pago.row_number,
                          })
                        }
                        disabled={isBusy}
                      >
                        {isDeleting ? "Eliminando..." : "Eliminar"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {dialog.visible && (
        <div className="modal-overlay">
          <div className="modal-box">
            <p className="modal-text">{textoDialogo}</p>

            <div className="modal-buttons">
              <button
                className="modal-cancelar"
                onClick={cerrarDialogo}
                disabled={!!savingRow || !!deletingRow}
              >
                Cancelar
              </button>
              <button
                className="modal-confirmar"
                onClick={confirmarAccion}
                disabled={!!savingRow || !!deletingRow}
              >
                {savingRow
                  ? "Guardando..."
                  : deletingRow
                  ? "Eliminando..."
                  : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModuloPagos;
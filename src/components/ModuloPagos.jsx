import { useState, useEffect } from "react";
import "../styles/ModuloPagos.css";

const ModuloPagos = ({ data, onOperacion }) => {
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
  
  const añoActual = new Date().getFullYear();

  const meses = [
    "Enero","Febrero","Marzo","Abril","Mayo","Junio",
    "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
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
    }
  }, [data]);

  const mostrarDialogo = (tipo, index, payload = null) => {
    setDialog({
      visible: true,
      tipo,
      index,
      payload,
    });
  };
  const cerrarDialogo = () => {
    setDialog({
      visible: false,
      tipo: "",
      index: null,
      payload: null,
    });
  };
  const confirmarAccion = () => {
    if (dialog.tipo === "eliminar") {
      onOperacion("eliminar", dialog.payload);
    }
  
    if (dialog.tipo === "guardar") {
      // Ejecutar guardado final
      onOperacion("actualizar", {
        "ID Elemento": data["ID Elemento"],
        "ID Pago": editData["ID Pago"],
        row_number: editData.row_number,
        Mes: editData.Mes,
        Año: añoActual,
        Cantidad: editData.Cantidad,
        "Tipo de Pago": editData["Tipo de Pago"],
      });
      setEditIndex(null);
    }
  
    cerrarDialogo();
  };
  

  const toggleExpand = (index) => {
    setExpanded((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const handleEdit = (index) => {
    setEditIndex(index);
    setEditData(pagos[index]);
  };

  const handleChange = (e) => {
    setEditData({ ...editData, [e.target.name]: e.target.value });
  };

  const handleSave = () => {
    onOperacion("actualizar", {
      "ID Elemento": data["ID Elemento"],
      "ID Pago": editData["ID Pago"],
      row_number: editData.row_number,
      Mes: editData.Mes,
      Año: añoActual,
      Cantidad: editData.Cantidad,
      "Tipo de Pago": editData["Tipo de Pago"],
    });
    setEditIndex(null);
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
          {pagos.map((pago, index) => (
            <div
              className={`pago-card ${pago.Pagado ? "pago-ok" : "pago-pendiente"}`}
              key={index}
            >
    
              {/* Flecha de expandir */}
              <div
                className={`expand-arrow ${expanded[index] ? "open" : ""}`}
                onClick={() => toggleExpand(index)}
              >
                ▼
              </div>
    
              {/* ----- MODO EDICIÓN ----- */}
              {editIndex === index ? (
                <div className="pago-edit">
                  <select
                    name="Mes"
                    value={editData.Mes}
                    onChange={handleChange}
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
                    value={editData.Cantidad}
                    onChange={handleChange}
                    placeholder="Cantidad"
                  />
    
                  <select
                    name="Tipo de Pago"
                    value={editData["Tipo de Pago"]}
                    onChange={handleChange}
                  >
                    <option value="Efectivo">Efectivo</option>
                    <option value="Transferencia">Transferencia</option>
                  </select>
    
                  <div className="pago-btns">
                  <button
                    className="btn-guardar"
                    onClick={() =>
                      mostrarDialogo("guardar", editIndex)
                    }
                  >
                    Guardar
                  </button>
                    <button
                      className="btn-cancelar"
                      onClick={() => setEditIndex(null)}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                /* ----- MODO NORMAL ----- */
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
    
                  {/* CONTENIDO EXPANDIBLE */}
                  {expanded[index] && pago.Pagado && (
                    <div className="pago-btns">
                      <button
                      className="btn-editar"
                      onClick={() => handleEdit(index)}
                    >
                      Editar
                    </button>

    
                      <button
                        className="btn-eliminar"
                        onClick={() =>
                          mostrarDialogo("eliminar", index, {
                            "ID Elemento": data["ID Elemento"],
                            "ID Pago": pago["ID Pago"],
                            row_number: pago.row_number,
                          })
                        }
                      >
                        Eliminar
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
    
        {/* ----- MODAL DE CONFIRMACIÓN ----- */}
        {dialog.visible && (
          <div className="modal-overlay">
            <div className="modal-box">
              <p className="modal-text">
                {dialog.tipo === "eliminar"
                  ? "¿Seguro que deseas eliminar este pago?"
                  : "¿Seguro que deseas editar este pago?"}
              </p>
    
              <div className="modal-buttons">
                <button className="modal-cancelar" onClick={cerrarDialogo}>
                  Cancelar
                </button>
                <button className="modal-confirmar" onClick={confirmarAccion}>
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
    
};

export default ModuloPagos;

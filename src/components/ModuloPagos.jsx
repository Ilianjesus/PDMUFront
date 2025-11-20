import { useState, useEffect } from "react";
import "../styles/ModuloPagos.css";

const ModuloPagos = ({ data, onOperacion }) => {
  const [pagos, setPagos] = useState([]);
  const [editIndex, setEditIndex] = useState(null);
  const [editData, setEditData] = useState({});

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
    }
  }, [data]);

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

  const handleCancelar = () => {
    setEditIndex(null);
    setEditData({});
  };

  return (
    <div className="pagos-container">
      <h3 className="pagos-titulo">💰 Pagos del Año</h3>

      <p className="pagos-alumno">
        <strong>Alumno:</strong> {data["Nombre Elemento"]} <br />
        <strong>ID:</strong> {data["ID Elemento"]} <br />
        <strong>Año:</strong> {añoActual}
      </p>

      <div className="pagos-grid">
        {pagos.map((pago, index) => (
          <div
            className={`pago-card ${pago.Pagado ? "pago-ok" : "pago-pendiente"}`}
            key={index}
          >
            {editIndex === index ? (
              <div className="pago-edit">
                <select name="Mes" value={editData.Mes} onChange={handleChange}>
                  {meses.map((m) => (
                    <option key={m} value={m}>{m}</option>
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
                  <button className="btn-guardar" onClick={handleSave}>
                    💾 Guardar
                  </button>
                  <button className="btn-cancelar" onClick={handleCancelar}>
                    ❌ Cancelar
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

                {pago.Pagado && (
                  <div className="pago-btns">
                    <button className="btn-editar" onClick={() => handleEdit(index)}>
                      ✏️ Editar
                    </button>

                    <button
                      className="btn-eliminar"
                      onClick={() =>
                        onOperacion("eliminar", {
                          "ID Elemento": data["ID Elemento"],
                          "ID Pago": pago["ID Pago"],
                          row_number: pago.row_number,
                        })
                      }
                    >
                      🗑 Eliminar
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ModuloPagos;

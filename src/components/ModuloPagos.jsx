import { useState, useEffect } from "react";

const ModuloPagos = ({ data, onOperacion }) => {
  const [pagos, setPagos] = useState([]);
  const [editIndex, setEditIndex] = useState(null);
  const [editData, setEditData] = useState({});

  useEffect(() => {
    if (data?.pagos && Array.isArray(data.pagos)) {
      const mesesOrden = {
        Enero: 1, Febrero: 2, Marzo: 3, Abril: 4, Mayo: 5, Junio: 6,
        Julio: 7, Agosto: 8, Septiembre: 9, Octubre: 10, Noviembre: 11, Diciembre: 12,
      };
      const ordenados = [...data.pagos].sort((a, b) => {
        if (a.Año !== b.Año) return a.Año - b.Año;
        return mesesOrden[a.Mes] - mesesOrden[b.Mes];
      });
      setPagos(ordenados);
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
      Año: editData.Año,
      Cantidad: editData.Cantidad,
      "Tipo de Pago": editData["Tipo de Pago"],
    });
    setEditIndex(null);
  };

  const handleCancel = () => {
    setEditIndex(null);
    setEditData({});
  };

  if (!pagos.length) return <p>No se encontraron pagos registrados.</p>;

  const meses = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];

  return (
    <div style={{ marginTop: "20px" }}>
      <h4>💰 Historial de Pagos</h4>
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
            <th style={th}>Mes</th>
            <th style={th}>Año</th>
            <th style={th}>Cantidad</th>
            <th style={th}>Tipo de Pago</th>
            <th style={th}>Fecha Registro</th>
            <th style={th}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {pagos.map((pago, index) => (
            <tr key={index}>
              {editIndex === index ? (
                <>
                  <td style={td}>
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
                  </td>
                  <td style={td}>
                    <input
                      type="number"
                      name="Año"
                      value={editData.Año}
                      onChange={handleChange}
                      style={{ width: "70px" }}
                    />
                  </td>
                  <td style={td}>
                    <input
                      type="number"
                      name="Cantidad"
                      value={editData.Cantidad}
                      onChange={handleChange}
                      style={{ width: "80px" }}
                    />
                  </td>
                  <td style={td}>
                    <select
                      name="Tipo de Pago"
                      value={editData["Tipo de Pago"]}
                      onChange={handleChange}
                    >
                      <option value="Efectivo">Efectivo</option>
                      <option value="Transferencia">Transferencia</option>
                    </select>
                  </td>
                  <td style={td}>{editData["Fecha Registro"]}</td>
                  <td style={td}>
                    <button
                      onClick={handleSave}
                      style={btnGuardar}
                    >
                      💾 Guardar
                    </button>
                    <button
                      onClick={handleCancel}
                      style={btnCancelar}
                    >
                      ❌ Cancelar
                    </button>
                  </td>
                </>
              ) : (
                <>
                  <td style={td}>{pago.Mes}</td>
                  <td style={td}>{pago.Año}</td>
                  <td style={td}>${pago.Cantidad}</td>
                  <td style={td}>{pago["Tipo de Pago"]}</td>
                  <td style={td}>{pago["Fecha Registro"]}</td>
                  <td style={td}>
                    <button
                      onClick={() => handleEdit(index)}
                      style={btnEditar}
                    >
                      ✏️ Editar
                    </button>
                    <button
                      onClick={() =>
                        onOperacion("eliminar", {
                          "ID Elemento": data["ID Elemento"],
                          "ID Pago": pago["ID Pago"],
                          row_number: pago.row_number,
                        })
                      }
                      style={btnEliminar}
                    >
                      🗑 Eliminar
                    </button>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// Estilos simples
const th = {
  border: "1px solid #ddd",
  padding: "8px",
  textAlign: "left",
};
const td = {
  border: "1px solid #ddd",
  padding: "8px",
};
const btnEditar = {
  backgroundColor: "#4CAF50",
  color: "white",
  border: "none",
  padding: "4px 8px",
  borderRadius: "4px",
  cursor: "pointer",
  marginRight: "5px",
};
const btnEliminar = {
  backgroundColor: "#ff4d4d",
  color: "white",
  border: "none",
  padding: "4px 8px",
  borderRadius: "4px",
  cursor: "pointer",
};
const btnGuardar = {
  backgroundColor: "#008CBA",
  color: "white",
  border: "none",
  padding: "4px 8px",
  borderRadius: "4px",
  cursor: "pointer",
  marginRight: "5px",
};
const btnCancelar = {
  backgroundColor: "#999",
  color: "white",
  border: "none",
  padding: "4px 8px",
  borderRadius: "4px",
  cursor: "pointer",
};

export default ModuloPagos;

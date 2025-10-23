import { useState, useEffect } from "react";

const ModuloInfo = ({ data, onOperacion }) => {
  const [form, setForm] = useState({});

  useEffect(() => {
    setForm(data);
  }, [data]);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  return (
    <div style={{ marginTop: "20px" }}>
      <h4>Información Personal</h4>

      <input
        name="Nombre(s)"
        value={form["Nombre(s)"] || ""}
        onChange={handleChange}
        placeholder="Nombre(s)"
      />
      <input
        name="Apellido paterno"
        value={form["Apellido paterno"] || ""}
        onChange={handleChange}
        placeholder="Apellido paterno"
      />
      <input
        name="Apellido materno"
        value={form["Apellido materno"] || ""}
        onChange={handleChange}
        placeholder="Apellido materno"
      />
      <input
        name="Telefono del tutor"
        value={form["Telefono del tutor"] || ""}
        onChange={handleChange}
        placeholder="Teléfono del tutor"
      />
      <input
        name="Enfermedades"
        value={form["Enfermedades"] || ""}
        onChange={handleChange}
        placeholder="Enfermedades"
      />

      <input
        name="Fecha de nacimiento"
        value={form["Fecha de nacimiento"] || ""}
        onChange={handleChange}
        placeholder="Fecha de nacimiento"
      />
      

      <div style={{ marginTop: "10px" }}>
        <button onClick={() => onOperacion("actualizar", form)}>💾 Actualizar</button>
        <button onClick={() => onOperacion("eliminar", { ID: form.ID })}>🗑 Eliminar</button>
      </div>
    </div>
  );
};

export default ModuloInfo;

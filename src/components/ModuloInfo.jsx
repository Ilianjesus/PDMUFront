import { useState, useEffect } from "react";
import "../styles/ModuloInfo.css"; // Asegúrate que la ruta sea correcta

const ModuloInfo = ({ data, onOperacion }) => {
  const [form, setForm] = useState({});

  useEffect(() => {
    setForm(data);
  }, [data]);

  const handleChange = (e) => {
    const { name, value } = e.target;

    if (
      name === "Nombres" ||
      name === "ApellidoPaterno" ||
      name === "ApellidoMaterno" ||
      name === "Tutor"
    ) {
      const regex = /^[A-Za-zÁÉÍÓÚáéíóúñÑ ]*$/;
      if (!regex.test(value)) return;
    }

    if (name === "TelefonoTutor") {
      const regex = /^[0-9]*$/;
      if (!regex.test(value)) return;
      if (value.length > 10) return;
    }

    setForm({ ...form, [name]: value });
  };

  return (
    <div className="modulo-info-container">
      <h4 className="modulo-info-title">Información Personal</h4>

      <div className="modulo-info-form">

        <div className="form-group">
          <label>Nombre(s)</label>
          <input
            name="Nombres"
            value={form.Nombres || ""}
            onChange={handleChange}
            placeholder="Nombre(s)"
            className="input"
          />
        </div>

        <div className="form-group">
          <label>Apellido paterno</label>
          <input
            name="ApellidoPaterno"
            value={form.ApellidoPaterno || ""}
            onChange={handleChange}
            placeholder="Apellido paterno"
            className="input"
          />
        </div>

        <div className="form-group">
          <label>Apellido materno</label>
          <input
            name="ApellidoMaterno"
            value={form.ApellidoMaterno || ""}
            onChange={handleChange}
            placeholder="Apellido materno"
            className="input"
          />
        </div>

        <div className="form-group">
          <label>Teléfono del tutor</label>
          <input
            name="TelefonoTutor"
            value={form.TelefonoTutor || ""}
            onChange={handleChange}
            placeholder="Teléfono del tutor"
            maxLength={10}
            className="input"
          />
        </div>

        <div className="form-group">
          <label>Tutor</label>
          <input
            name="Tutor"
            value={form.Tutor || ""}
            onChange={handleChange}
            placeholder="Tutor"
            className="input"
          />
        </div>

        <div className="form-group">
          <label>Enfermedades</label>
          <input
            name="Enfermedades"
            value={form.Enfermedades || ""}
            onChange={handleChange}
            placeholder="Enfermedades"
            className="input"
          />
        </div>

        <div className="form-group">
          <label>Fecha de nacimiento</label>
          <input
            type="date"
            name="FechaNacimiento"
            value={form.FechaNacimiento || ""}
            onChange={handleChange}
            className="input"
          />
        </div>

        <div className="form-group">
          <label>Sexo</label>
          <select
            name="Sexo"
            value={form.Sexo || ""}
            onChange={handleChange}
            className="input"
          >
            <option value="">Seleccionar sexo</option>
            <option value="Masculino">Masculino</option>
            <option value="Femenino">Femenino</option>
          </select>
        </div>

        <div className="form-group">
          <label>Grupo</label>
          <input
            name="Grupo"
            value={form.Grupo || ""}
            placeholder="Grupo"
            className="input input-disabled"
            disabled
          />
        </div>

        <div className="form-group">
          <label>QR</label>
          <input
            name="QR"
            value={form.QR || ""}
            placeholder="QR"
            className="input input-disabled"
            disabled
          />
        </div>

        {/* DOCUMENTOS — NO EDITABLES */}

        <div className="form-group">
          <label>INE del tutor</label>
          <input
            name="ineTutor"
            value={form.ineTutor || ""}
            placeholder="INE del tutor"
            className="input input-disabled"
            disabled
          />
        </div>

        <div className="form-group">
          <label>Certificado médico</label>
          <input
            name="certificadoMedico"
            value={form.certificadoMedico || ""}
            placeholder="Certificado médico"
            className="input input-disabled"
            disabled
          />
        </div>

        <div className="form-group">
          <label>Comprobante de domicilio</label>
          <input
            name="comprobanteDomicilio"
            value={form.comprobanteDomicilio || ""}
            placeholder="Comprobante de domicilio"
            className="input input-disabled"
            disabled
          />
        </div>

        <div className="form-group">
          <label>Acta de nacimiento</label>
          <input
            name="actaNacimiento"
            value={form.actaNacimiento || ""}
            placeholder="Acta de nacimiento"
            className="input input-disabled"
            disabled
          />
        </div>

        <div className="form-group">
          <label>CURP</label>
          <input
            name="curp"
            value={form.curp || ""}
            placeholder="CURP"
            className="input input-disabled"
            disabled
          />
        </div>

        <div className="form-group">
          <label>Hoja de inscripción</label>
          <input
            name="hojaInscripcion"
            value={form.hojaInscripcion || ""}
            placeholder="Hoja de inscripción"
            className="input input-disabled"
            disabled
          />
        </div>
      </div>

      <div className="modulo-info-buttons">
        <button className="btn-guardar" onClick={() => onOperacion("actualizar", form)}>
          💾 Guardar cambios
        </button>

        <button className="btn-eliminar" onClick={() => onOperacion("eliminar", { ID: data.ID })}>
          🗑 Eliminar usuario
        </button>
      </div>
    </div>
  );
};

export default ModuloInfo;

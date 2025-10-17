import { useState } from "react";
import "../styles/global.css";

export function RegistrarElemento() {
  const [formData, setFormData] = useState({
    nombre: "",
    apellidoPaterno: "",
    apellidoMaterno: "",
    grupo: "",
    fechaNacimiento: "",
    sexo: "",
    tutor: "",
    telefonoTutor: "",
    enfermedades: "",
  });

  const [files, setFiles] = useState({
    ineTutor: null,
    certificadoMedico: null,
    comprobanteDomicilio: null,
    actaNacimiento: null,
    curp: null,
    hojaInscripcion: null,
  });

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleFileChange = (e) => {
    setFiles({
      ...files,
      [e.target.name]: e.target.files[0],
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const hoy = new Date().toISOString().split("T")[0];
    if (formData.fechaNacimiento > hoy) {
      alert("La fecha de nacimiento no puede ser futura ❌");
      return;
    }

    if (!/^\d{10}$/.test(formData.telefonoTutor)) {
      alert("El teléfono debe contener exactamente 10 dígitos numéricos ❌");
      return;
    }

    try {
      const data = new FormData();
      for (const key in formData) data.append(key, formData[key]);
      for (const key in files)
        if (files[key]) data.append(key, files[key]);

      const response = await fetch(
        "https://n8n.scolaris.com.mx/webhook-test/799fdd72-8c7c-42bb-9269-01077461fc38",
        { method: "POST", body: data }
      );

      if (response.ok) {
        alert("Registro enviado correctamente ✅");
        setFormData({
          nombre: "",
          apellidoPaterno: "",
          apellidoMaterno: "",
          grupo: "",
          fechaNacimiento: "",
          sexo: "",
          tutor: "",
          telefonoTutor: "",
          enfermedades: "",
        });
        setFiles({
          ineTutor: null,
          certificadoMedico: null,
          comprobanteDomicilio: null,
          actaNacimiento: null,
          curp: null,
          hojaInscripcion: null,
        });
        e.target.reset();
      } else {
        alert("Error al enviar el registro ❌");
      }
    } catch (error) {
      console.error("Error:", error);
      alert("Hubo un problema al conectar con el servidor ❌");
    }
  };

  return (
    <div className="registrar-container">
      <h2 className="registrar-title">Registrar Elemento</h2>
      <form className="registrar-form" onSubmit={handleSubmit}>

        <input
          className="registrar-input"
          type="text"
          name="nombre"
          placeholder="Nombre(s)"
          value={formData.nombre}
          onChange={handleChange}
          required
        />

        <input
          className="registrar-input"
          type="text"
          name="apellidoPaterno"
          placeholder="Apellido paterno"
          value={formData.apellidoPaterno}
          onChange={handleChange}
          required
        />

        <input
          className="registrar-input"
          type="text"
          name="apellidoMaterno"
          placeholder="Apellido materno"
          value={formData.apellidoMaterno}
          onChange={handleChange}
        />

        <select
          className="registrar-select"
          name="sexo"
          value={formData.sexo}
          onChange={handleChange}
          required
        >
          <option value="">Sexo</option>
          <option value="Masculino">Masculino</option>
          <option value="Femenino">Femenino</option>
          <option value="Otro">Otro</option>
        </select>

        <div className="form-group">
          <label className="registrar-label">Fecha de nacimiento:</label>
          <input
            className="registrar-input"
            type="date"
            name="fechaNacimiento"
            value={formData.fechaNacimiento}
            onChange={handleChange}
            max={new Date().toISOString().split("T")[0]} // ❌ no permite fechas futuras
            required
            />
        </div>

        <input
          className="registrar-input"
          type="text"
          name="tutor"
          placeholder="Nombre del tutor"
          value={formData.tutor}
          onChange={handleChange}
          required
        />

        <input
          className="registrar-input"
          type="tel"
          name="telefonoTutor"
          placeholder="Teléfono del tutor (10 dígitos)"
          value={formData.telefonoTutor}
          onChange={(e) => {
            const value = e.target.value.replace(/\D/g, "").slice(0, 10);
            setFormData({ ...formData, telefonoTutor: value });
          }}
          pattern="[0-9]{10}"
          required
        />

        <textarea
          className="registrar-textarea"
          name="enfermedades"
          value={formData.enfermedades}
          onChange={handleChange}
          placeholder="Enfermedades o condiciones médicas (opcional)"
        />

        {/* Archivos PDF */}
        <div className="file-upload">
          <label className="file-label">INE del Tutor (PDF)</label>
          <label className="file-custom">
            <span>Seleccionar archivo</span>
            <input
              type="file"
              name="ineTutor"
              accept="application/pdf"
              onChange={handleFileChange}
            />
          </label>
          {files.ineTutor && <p className="file-name">{files.ineTutor.name}</p>}
        </div>

        <div className="file-upload">
          <label className="file-label">Certificado Médico (PDF)</label>
          <label className="file-custom">
            <span>Seleccionar archivo</span>
            <input
              type="file"
              name="certificadoMedico"
              accept="application/pdf"
              onChange={handleFileChange}
            />
          </label>
          {files.certificadoMedico && (
            <p className="file-name">{files.certificadoMedico.name}</p>
          )}
        </div>

        <div className="file-upload">
          <label className="file-label">Comprobante de Domicilio (PDF)</label>
          <label className="file-custom">
            <span>Seleccionar archivo</span>
            <input
              type="file"
              name="comprobanteDomicilio"
              accept="application/pdf"
              onChange={handleFileChange}
            />
          </label>
          {files.comprobanteDomicilio && (
            <p className="file-name">{files.comprobanteDomicilio.name}</p>
          )}
        </div>

        <div className="file-upload">
          <label className="file-label">Acta de Nacimiento (PDF)</label>
          <label className="file-custom">
            <span>Seleccionar archivo</span>
            <input
              type="file"
              name="actaNacimiento"
              accept="application/pdf"
              onChange={handleFileChange}
            />
          </label>
          {files.actaNacimiento && (
            <p className="file-name">{files.actaNacimiento.name}</p>
          )}
        </div>

        <div className="file-upload">
          <label className="file-label">CURP (PDF)</label>
          <label className="file-custom">
            <span>Seleccionar archivo</span>
            <input
              type="file"
              name="curp"
              accept="application/pdf"
              onChange={handleFileChange}
            />
          </label>
          {files.curp && <p className="file-name">{files.curp.name}</p>}
        </div>

        <div className="file-upload">
          <label className="file-label">Hoja de Inscripción (PDF)</label>
          <label className="file-custom">
            <span>Seleccionar archivo</span>
            <input
              type="file"
              name="hojaInscripcion"
              accept="application/pdf"
              onChange={handleFileChange}
            />
          </label>
          {files.hojaInscripcion && (
            <p className="file-name">{files.hojaInscripcion.name}</p>
          )}
        </div>

        <button className="registrar-button" type="submit">
          Registrar
        </button>
      </form>
    </div>
  );
}

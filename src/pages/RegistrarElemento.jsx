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
    acataNacimiento: null,
    curp: null,
    comprobanteDomicilio: null,
    ineTutor: null,
    certificadoMedico: null, 
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

    try {
      // Usamos FormData para enviar texto + archivos
      const data = new FormData();

      // Agregar los campos de texto
      for (const key in formData) {
        data.append(key, formData[key]);
      }

      // Agregar los archivos PDF
      for (const key in files) {
        if (files[key]) {
          data.append(key, files[key]);
        }
      }

      const response = await fetch(
        "https://n8n.scolaris.com.mx/webhook-test/799fdd72-8c7c-42bb-9269-01077461fc38",
        {
          method: "POST",
          body: data, // No se pone Content-Type porque FormData lo hace automático
        }
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
          actaNacimiento: null,
          curp: null,
          comprobanteDomicilio: null,
          ineTutor: null,
          certificadoMedico: null,
        });
        e.target.reset(); // Limpia los inputs de archivo
      } else {
        alert("Error al enviar el registro ❌");
      }
    } catch (error) {
      console.error("Error en el POST:", error);
      alert("Hubo un problema al conectar con el servidor ❌");
    }
  };

  return (
    <div className="registrar-container">
      <h2 className="registrar-title">Registrar Elemento</h2>
      <form className="registrar-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="registrar-label">Nombre(s):</label>
          <input
            className="registrar-input"
            type="text"
            name="nombre"
            value={formData.nombre}
            onChange={handleChange}
            required
          />
        </div>

        <div className="form-group">
          <label className="registrar-label">Apellido paterno:</label>
          <input
            className="registrar-input"
            type="text"
            name="apellidoPaterno"
            value={formData.apellidoPaterno}
            onChange={handleChange}
            required
          />
        </div>

        <div className="form-group">
          <label className="registrar-label">Apellido materno:</label>
          <input
            className="registrar-input"
            type="text"
            name="apellidoMaterno"
            value={formData.apellidoMaterno}
            onChange={handleChange}
          />
        </div>

        <div className="form-group">
          <label className="registrar-label">Sexo:</label>
          <select
            className="registrar-select"
            name="sexo"
            value={formData.sexo}
            onChange={handleChange}
            required
          >
            <option value="">Seleccione...</option>
            <option value="M">Masculino</option>
            <option value="F">Femenino</option>
            <option value="O">Otro</option>
          </select>
        </div>

        <div className="form-group">
          <label className="registrar-label">Grupo:</label>
          <select
            className="registrar-select"
            name="grupo"
            value={formData.grupo}
            onChange={handleChange}
            required
          >
            <option value="">Seleccione...</option>
            <option value="Mayor varonil">Mayor varonil</option>
            <option value="Mayor femenil">Mayor femenil</option>
            <option value="Juvenil varonil">Juvenil varonil</option>
            <option value="Juvenil femenil">Juvenil femenil</option>
            <option value="Menor varonil">Menor varonil</option>
            <option value="Menor femenil">Menor femenil</option>
          </select>
        </div>

        <div className="form-group">
          <label className="registrar-label">Fecha de nacimiento:</label>
          <input
            className="registrar-input"
            type="date"
            name="fechaNacimiento"
            value={formData.fechaNacimiento}
            onChange={handleChange}
            required
          />
        </div>

        <div className="form-group">
          <label className="registrar-label">Tutor:</label>
          <input
            className="registrar-input"
            type="text"
            name="tutor"
            value={formData.tutor}
            onChange={handleChange}
            required
          />
        </div>

        <div className="form-group">
          <label className="registrar-label">Teléfono de tutor:</label>
          <input
            className="registrar-input"
            type="tel"
            name="telefonoTutor"
            value={formData.telefonoTutor}
            onChange={handleChange}
            placeholder="Ej. 555-123-4567"
            required
          />
        </div>

        <div className="form-group">
          <label className="registrar-label">Enfermedades (opcional):</label>
          <textarea
            className="registrar-textarea"
            name="enfermedades"
            value={formData.enfermedades}
            onChange={handleChange}
            placeholder="Indicar si tiene alguna condición médica"
          />
        </div>

        <div className="form-group">
          <label className="registrar-label">Acta de nacimiento (PDF):</label>
          <input
            className="registrar-input"
            type="file"
            name="actaNacimiento"
            accept="application/pdf"
            onChange={handleFileChange}
            required
          />
        </div>

        <div className="form-group">
          <label className="registrar-label">CURP (PDF):</label>
          <input
            className="registrar-input"
            type="file"
            name="curp"
            accept="application/pdf"
            onChange={handleFileChange}
            required
          />
        </div>

        <div className="form-group">
          <label className="registrar-label">Comprobante de domicilio (PDF):</label>
          <input
            className="registrar-input"
            type="file"
            name="comprobanteDomicilio"
            accept="application/pdf"
            onChange={handleFileChange}
            required
          />
        </div>

        <div className="form-group">
          <label className="registrar-label">INE del padre/tutor (PDF):</label>
          <input
            className="registrar-input"
            type="file"
            name="ineTutor"
            accept="application/pdf"
            onChange={handleFileChange}
            required
          />
        </div>

        <div className="form-group">
          <label className="registrar-label">Certificado médico (PDF):</label>
          <input
            className="registrar-input"
            type="file"
            name="certificadoMedico"
            accept="application/pdf"
            onChange={handleFileChange}
            required
          />
        </div>

        <button className="registrar-button" type="submit">
          Registrar
        </button>
      </form>
    </div>
  );
}

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

  //Nuevo estado para manejar el archivo PDF
  const [files, setFiles] = useState({
    ineTutor: null,
    certificadoMedico: null,
    comprobanteDomicilio: null,
    actaNacimiento: null,
    curp: null,
    hojaInscripcion: null,
  })

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
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
  
    // ✅ Validación de fecha de nacimiento
    const hoy = new Date().toISOString().split("T")[0];
    if (formData.fechaNacimiento > hoy) {
      alert("La fecha de nacimiento no puede ser futura ❌");
      return;
    }
  
    // ✅ Validación de teléfono (exactamente 10 dígitos numéricos)
    if (!/^\d{10}$/.test(formData.telefonoTutor)) {
      alert("El teléfono debe contener exactamente 10 dígitos numéricos ❌");
      return;
    }
  
    try {
      const data = new FormData();
      for (const key in formData) {
        data.append(key, formData[key]);
      }
      for (const key in files) {
        if (files[key]) {
          data.append(key, files[key]);
        }
      }
  
      console.log("=== FormData ===");
      for (let pair of data.entries()) {
        console.log(pair[0], pair[1]);
      }
  
      const response = await fetch(
        "https://n8n.scolaris.com.mx/webhook-test/799fdd72-8c7c-42bb-9269-01077461fc38",
        {
          method: "POST",
          body: data,
        }
      );
  
      console.log("Response status:", response.status);
  
      if (response.ok) {
        const respText = await response.text();
        console.log("Respuesta del servidor:", respText);
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
        const errorText = await response.text();
        console.error("Error del servidor:", errorText);
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
            <option value="Masculino">Masculino</option>
            <option value="Femenino">Femenino</option>
            <option value="Otro">Otro</option>
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
            max={new Date().toISOString().split("T")[0]} // ❌ no permite fechas futuras
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
            onChange={(e) => {
              // Solo números y máximo 10 dígitos
              const value = e.target.value.replace(/\D/g, "").slice(0, 10);
              setFormData({ ...formData, telefonoTutor: value });
            }}
            pattern="[0-9]{10}" // valida que tenga 10 dígitos
            placeholder="Ej. 5512345678"
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

        <div className="file-upload">
  <label className="file-label">Ine Tutor (PDF):</label>
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
  <label className="file-label">Certificado Médico (PDF):</label>
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
  <label className="file-label">Comprobante de Domicilio (PDF):</label>
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
  <label className="file-label">Acta de Nacimiento (PDF):</label>
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
  <label className="file-label">CURP (PDF):</label>
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
  <label className="file-label">Hoja de Inscripción (PDF):</label>
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
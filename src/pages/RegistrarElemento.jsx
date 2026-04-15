import { useState } from "react";
import "../styles/global.css";

export function RegistrarElemento() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  const initialFormData = {
    nombre: "",
    apellidoPaterno: "",
    apellidoMaterno: "",
    grupo: "",
    fechaNacimiento: "",
    sexo: "",
    tutor: "",
    telefonoTutor: "",
    enfermedades: "",
  };

  const initialFiles = {
    ineTutor: null,
    certificadoMedico: null,
    comprobanteDomicilio: null,
    actaNacimiento: null,
    curp: null,
    hojaInscripcion: null,
  };

  const [formData, setFormData] = useState(initialFormData);
  const [files, setFiles] = useState(initialFiles);

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

  const handleNext = () => setStep((prev) => prev + 1);
  const handleBack = () => setStep((prev) => prev - 1);

  const resetForm = () => {
    setFormData(initialFormData);
    setFiles(initialFiles);
    setStep(1);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const hoy = new Date().toISOString().split("T")[0];

    if (formData.fechaNacimiento > hoy) {
      alert("La fecha de nacimiento no puede ser futura ❌");
      setLoading(false);
      return;
    }

    if (!/^\d{10}$/.test(formData.telefonoTutor)) {
      alert("El teléfono debe contener exactamente 10 dígitos numéricos ❌");
      setLoading(false);
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

      const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_INSCRIPCION;

      if (!webhookUrl) {
        alert("⚠️ Falta la variable VITE_N8N_WEBHOOK_INSCRIPCION en .env");
        return;
      }

      const response = await fetch(webhookUrl, {
        method: "POST",
        body: data,
      });

      let result = null;

      try {
        result = await response.json();
      } catch (jsonError) {
        console.error("La respuesta del webhook no es JSON válido:", jsonError);
      }

      if (!response.ok) {
        alert(result?.message || "No se pudo completar la inscripción ❌");
        return;
      }

      const status = result?.status?.toLowerCase?.().trim?.();

      if (status === "success") {
        alert(result?.message || "La inscripción se completó correctamente 🎉");
        resetForm();
      } else if (status === "already exists") {
        alert(result?.message || "El elemento ya existe en el sistema ⚠️");
      } else {
        alert(result?.message || "La inscripción no pudo completarse ❌");
      }
    } catch (error) {
      console.error("Error:", error);
      alert("Hubo un problema al conectar con el servidor ❌");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="registrar-container">
      {loading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
        </div>
      )}

      <h2 className="registrar-title">Formulario de inscripción</h2>

      <div style={{ display: "flex", gap: "10px", marginBottom: "1rem" }}>
        <div className={`step-indicator ${step === 1 ? "active" : ""}`}>1</div>
        <div className={`step-indicator ${step === 2 ? "active" : ""}`}>2</div>
        <div className={`step-indicator ${step === 3 ? "active" : ""}`}>3</div>
      </div>

      <form className="registrar-form" onSubmit={handleSubmit}>
        {step === 1 && (
          <>
            <div>
              <h2 className="registrar-subtitle">Datos del elemento</h2>
            </div>

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
            </select>

            <div className="form-group">
              <label className="registrar-label">Fecha de nacimiento:</label>
              <input
                className="registrar-input"
                type="date"
                name="fechaNacimiento"
                value={formData.fechaNacimiento}
                onChange={handleChange}
                max={new Date().toISOString().split("T")[0]}
                required
              />
            </div>

            <textarea
              className="registrar-textarea"
              name="enfermedades"
              value={formData.enfermedades}
              onChange={handleChange}
              placeholder="Enfermedades o condiciones médicas (opcional)"
            />

            <button
              type="button"
              className="registrar-button"
              onClick={handleNext}
              disabled={loading}
            >
              Siguiente
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <div>
              <h2 className="registrar-subtitle">Datos del tutor</h2>
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
                setFormData({
                  ...formData,
                  telefonoTutor: value,
                });
              }}
              pattern="[0-9]{10}"
              required
            />

            <div style={{ display: "flex", gap: "10px", width: "100%" }}>
              <button
                type="button"
                className="registrar-button"
                onClick={handleBack}
                disabled={loading}
              >
                Atrás
              </button>

              <button
                type="button"
                className="registrar-button"
                onClick={handleNext}
                disabled={loading}
              >
                Siguiente
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div>
              <h2 className="registrar-subtitle">Documentos</h2>
            </div>

            {Object.entries({
              actaNacimiento: "Acta de nacimiento",
              curp: "CURP del elemento",
              certificadoMedico: "Certificado médico",
              hojaInscripcion: "Hoja de inscripción",
              ineTutor: "INE del tutor",
              comprobanteDomicilio: "Comprobante de domicilio",
            }).map(([key, label]) => (
              <div className="file-upload" key={key}>
                <label className="file-label">{label} (PDF)</label>

                <label className="file-custom">
                  <span>Seleccionar archivo</span>
                  <input
                    type="file"
                    name={key}
                    accept="application/pdf"
                    onChange={handleFileChange}
                  />
                </label>

                {files[key] && <p className="file-name">{files[key].name}</p>}
              </div>
            ))}

            <div style={{ display: "flex", gap: "10px", width: "100%" }}>
              <button
                type="button"
                className="registrar-button"
                onClick={handleBack}
                disabled={loading}
              >
                Atrás
              </button>

              <button
                className="registrar-button"
                type="submit"
                disabled={loading}
              >
                {loading ? "Enviando..." : "Enviar Registro"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
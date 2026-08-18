import { useEffect, useRef, useState } from "react";
import { Camera, Check, FileText, FileUp, Trash2 } from "lucide-react";
import { registerElement } from "../services/elementsService";
import { REGISTRATION_DOCUMENTS } from "../constants/registrationDocuments";
import { createRequestId } from "../services/supabaseBusiness/requestId";
import { PageHeader } from "../components/ui/PageHeader";
import { BirthDateSelector } from "../components/ui/BirthDateSelector";
import { StatusMessage } from "../components/ui/StatusMessage";
import { calculateAge, getElementGroup } from "../utils/elementGroups";
import "../styles/global.css";

const INITIAL_FORM_DATA = {
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

const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

function createInitialFiles() {
  return REGISTRATION_DOCUMENTS.reduce((files, document) => {
    files[document.key] = null;
    return files;
  }, {});
}

function getFullName(data) {
  return [
    data.nombre,
    data.apellidoPaterno,
    data.apellidoMaterno,
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

function FloatingField({
  id,
  label,
  as = "input",
  value,
  children,
  className,
  ...props
}) {
  const hasValue = value !== undefined && value !== null && String(value).length > 0;
  const Control = as;
  const controlClassName =
    className || (as === "textarea" ? "registrar-textarea" : as === "select" ? "registrar-select" : "registrar-input");
  const controlProps = {
    id,
    className: controlClassName,
    value,
    placeholder: " ",
    ...props,
  };

  return (
    <div className={`floating-field${hasValue ? " floating-field--filled" : ""}`}>
      {as === "input" ? (
        <input {...controlProps} />
      ) : (
        <Control {...controlProps}>{children}</Control>
      )}
      <label className="floating-field__label" htmlFor={id}>{label}</label>
    </div>
  );
}

function CalculatedField({ label, value, emptyText = "Se calcula automáticamente" }) {
  return (
    <div className={`calculated-field${value ? " calculated-field--filled" : ""}`}>
      <span className="calculated-field__label">{label}</span>
      <strong className="calculated-field__value">{value || emptyText}</strong>
    </div>
  );
}

function DocumentCapture({ document, file, loading, onChange, onRemove }) {
  const [previewUrl, setPreviewUrl] = useState("");
  const cameraInputRef = useRef(null);

  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setPreviewUrl("");
      return undefined;
    }

    const nextPreviewUrl = URL.createObjectURL(file);
    setPreviewUrl(nextPreviewUrl);
    return () => URL.revokeObjectURL(nextPreviewUrl);
  }, [file]);

  return (
    <article className={`document-capture${file ? " is-ready" : ""}`}>
      <button
        type="button"
        className="document-capture__primary"
        onClick={() => cameraInputRef.current?.click()}
        disabled={loading}
        aria-label={`${file ? "Volver a fotografiar" : "Fotografiar"} ${document.label}`}
      >
        <span className="document-capture__preview" aria-hidden="true">
          {previewUrl ? (
            <img src={previewUrl} alt="" />
          ) : file ? (
            <FileText />
          ) : (
            <Camera />
          )}
        </span>
        <span className="document-capture__copy">
          <strong>{document.label}</strong>
          <small>{file?.name || "Tomar foto"}</small>
        </span>
        {file && <Check className="document-capture__check" aria-hidden="true" />}
      </button>

      <input
        ref={cameraInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => onChange(event, document.key, "camera")}
        disabled={loading}
      />

      <div className="document-capture__actions">
        <label className="document-capture__file" title="Adjuntar archivo">
          <FileUp aria-hidden="true" />
          <span>Adjuntar</span>
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={(event) => onChange(event, document.key, "file")}
            disabled={loading}
          />
        </label>
        {file && (
          <button
            type="button"
            className="document-capture__remove"
            onClick={() => onRemove(document.key)}
            disabled={loading}
            title="Quitar documento"
            aria-label={`Quitar ${document.label}`}
          >
            <Trash2 aria-hidden="true" />
          </button>
        )}
      </div>
    </article>
  );
}

function getLocalDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function RegistrarElemento() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [selfTutor, setSelfTutor] = useState(false);
  const registrationRequestId = useRef(createRequestId());
  const assetsRequestId = useRef(createRequestId());

  const [formData, setFormData] = useState(INITIAL_FORM_DATA);
  const [files, setFiles] = useState(() => createInitialFiles());

  const age = calculateAge(formData.fechaNacimiento);
  const elementGroup = getElementGroup({
    birthDate: formData.fechaNacimiento,
    sex: formData.sexo,
  });
  const isAdult = age !== null && age >= 18;
  const fullName = getFullName(formData);
  const handleChange = (e) => {
    const { name, value } = e.target;
    const nextAge = name === "fechaNacimiento" ? calculateAge(value) : age;
    const shouldDisableSelfTutor =
      selfTutor && name === "fechaNacimiento" && (nextAge === null || nextAge < 18);

    if (shouldDisableSelfTutor) setSelfTutor(false);

    setFormData((current) => {
      const next = {
        ...current,
        [name]: value,
      };

      if (shouldDisableSelfTutor) {
        next.tutor = "";
        next.telefonoTutor = "";
      } else if (
        selfTutor &&
        ["nombre", "apellidoPaterno", "apellidoMaterno"].includes(name)
      ) {
        next.tutor = getFullName(next);
      }

      return next;
    });
  };

  const handleBirthDateChange = (value) => {
    const nextAge = calculateAge(value);
    const shouldDisableSelfTutor = selfTutor && (nextAge === null || nextAge < 18);

    if (shouldDisableSelfTutor) setSelfTutor(false);

    setFormData((current) => ({
      ...current,
      fechaNacimiento: value,
      ...(shouldDisableSelfTutor ? { tutor: "", telefonoTutor: "" } : {}),
    }));
  };

  const enableSelfTutor = async () => {
    if (!isAdult) return;
    if (!fullName) {
      await showAlert({
        icon: "warning",
        title: "Nombre incompleto",
        text: "Completa el nombre del elemento antes de usarlo como tutor.",
      });
      return;
    }

    setSelfTutor(true);
    setFormData((current) => ({
      ...current,
      tutor: getFullName(current),
    }));
  };

  const disableSelfTutor = () => {
    setSelfTutor(false);
    setFormData((current) => ({
      ...current,
      tutor: "",
      telefonoTutor: "",
    }));
  };

  const handleFileChange = (event, key) => {
    const file = event.target.files?.[0] ?? null;

    if (file && file.type !== "application/pdf" && !file.type.startsWith("image/")) {
      showAlert({
        icon: "error",
        title: "Archivo inválido",
        text: "Selecciona una fotografía o un documento PDF.",
      });
      event.target.value = "";
      return;
    }

    if (file && file.size > MAX_DOCUMENT_SIZE_BYTES) {
      showAlert({
        icon: "error",
        title: "Archivo demasiado grande",
        text: "Cada documento debe pesar 10 MB o menos.",
      });
      event.target.value = "";
      return;
    }

    setFiles((current) => ({
      ...current,
      [key]: file,
    }));
    event.target.value = "";
  };

  const removeFile = (key) => {
    setFiles((current) => ({ ...current, [key]: null }));
  };

  const handleNext = async () => {
    if (step === 1) {
      if (
        !formData.nombre.trim() ||
        !formData.apellidoPaterno.trim() ||
        !formData.sexo ||
        !formData.fechaNacimiento
      ) {
        await showAlert({
          icon: "warning",
          title: "Datos incompletos",
          text: "Completa nombre, apellido paterno, sexo y fecha de nacimiento.",
        });
        return;
      }

      const today = getLocalDateValue();
      if (formData.fechaNacimiento > today) {
        await showAlert({
          icon: "error",
          title: "Fecha inválida",
          text: "La fecha de nacimiento no puede ser futura.",
        });
        return;
      }
    }

    if (step === 2) {
      if (!formData.tutor.trim() || !/^\d{10}$/.test(formData.telefonoTutor)) {
        await showAlert({
          icon: "warning",
          title: "Datos del tutor incompletos",
          text: "Captura el nombre del tutor y un teléfono de 10 dígitos.",
        });
        return;
      }
    }

    setStep((previous) => Math.min(previous + 1, 3));
  };
  const handleBack = () => setStep((prev) => prev - 1);

  const resetForm = () => {
    setFormData(INITIAL_FORM_DATA);
    setFiles(createInitialFiles());
    setSelfTutor(false);
    setStep(1);
    registrationRequestId.current = createRequestId();
    assetsRequestId.current = createRequestId();
  };

  const showAlert = ({ icon, title, text }) => {
    setFeedback({
      variant: icon === "error" ? "error" : icon === "success" ? "success" : "warning",
      text: `${title}. ${text}`,
    });
    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    return Promise.resolve();
  };

  const showAlertAfterLoading = async (alertConfig) => {
    setLoading(false);
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    return showAlert(alertConfig);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const hoy = getLocalDateValue();

    if (formData.fechaNacimiento > hoy) {
      await showAlert({
        icon: "error",
        title: "Fecha inválida",
        text: "La fecha de nacimiento no puede ser futura.",
      });
      setLoading(false);
      return;
    }

    if (!/^\d{10}$/.test(formData.telefonoTutor)) {
      await showAlert({
        icon: "error",
        title: "Teléfono inválido",
        text: "El teléfono debe contener exactamente 10 dígitos numéricos.",
      });
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const result = await registerElement(
        {
          ...formData,
          selfTutor,
          requestId: registrationRequestId.current,
          assetsRequestId: assetsRequestId.current,
        },
        files
      );

      if (result.ok) {
        await showAlertAfterLoading({
          icon: "success",
          title: result.data?.reactivated ? "Inscripción reactivada" : "Perfil creado",
          text: result.message || "La inscripción se completó correctamente.",
        });
        resetForm();
      } else if (result.code === "ALREADY_EXISTS") {
        await showAlertAfterLoading({
          icon: "warning",
          title: "Elemento existente",
          text: result.message || "El elemento ya existe en el sistema.",
        });
      } else {
        await showAlertAfterLoading({
          icon: "error",
          title: "No se pudo completar",
          text: result.message || "La inscripción no pudo completarse.",
        });
      }
    } catch (error) {
      console.error("Error:", error);
      await showAlertAfterLoading({
        icon: "error",
        title: "Error de conexión",
        text: "Hubo un problema al conectar con el servidor.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="registrar-container page-shell">
      {loading && (
        <div className="loading-overlay" role="status" aria-live="polite">
          <div className="spinner"></div>
          <span>Enviando inscripción...</span>
        </div>
      )}

      <div className="page-shell__inner">
        <PageHeader
          eyebrow="Inscripciones"
          title="Registrar elemento"
          infoTooltip="Captura el expediente inicial en tres pasos. Los campos obligatorios se validan antes de continuar."
        />

        {feedback && (
          <StatusMessage variant={feedback.variant} className="registration-feedback">
            {feedback.text}
          </StatusMessage>
        )}

        <div className="registration-workspace">
          <ol className="step-list" aria-label={`Paso ${step} de 3`}>
            {["Elemento", "Contacto", "Documentos"].map((label, index) => {
              const stepNumber = index + 1;
              return (
                <li
                  key={label}
                  className={`step-item${step === stepNumber ? " active" : ""}${step > stepNumber ? " complete" : ""}`}
                  aria-current={step === stepNumber ? "step" : undefined}
                >
                  <span className="step-indicator">{stepNumber}</span>
                  <span>{label}</span>
                </li>
              );
            })}
          </ol>

          <form className="registrar-form" onSubmit={handleSubmit}>
        {step === 1 && (
          <>
            <div>
              <h2 className="registrar-subtitle">Datos del elemento</h2>
            </div>

            <FloatingField
              id="nombre"
              label="Nombre(s)"
              type="text"
              name="nombre"
              value={formData.nombre}
              onChange={handleChange}
              required
            />

            <FloatingField
              id="apellidoPaterno"
              label="Apellido paterno"
              type="text"
              name="apellidoPaterno"
              value={formData.apellidoPaterno}
              onChange={handleChange}
              required
            />

            <FloatingField
              id="apellidoMaterno"
              label="Apellido materno"
              type="text"
              name="apellidoMaterno"
              value={formData.apellidoMaterno}
              onChange={handleChange}
            />

            <fieldset className="registration-choice">
              <legend>Sexo</legend>
              <div className="registration-choice__options">
                {["Femenino", "Masculino"].map((option) => (
                  <label
                    key={option}
                    className={formData.sexo === option ? "is-selected" : ""}
                  >
                    <input
                      type="radio"
                      name="sexo"
                      value={option}
                      checked={formData.sexo === option}
                      onChange={handleChange}
                      required
                    />
                    <span>{option}</span>
                    {formData.sexo === option && <Check aria-hidden="true" />}
                  </label>
                ))}
              </div>
            </fieldset>

            <BirthDateSelector
              value={formData.fechaNacimiento}
              onChange={handleBirthDateChange}
            />

            <CalculatedField
              label="Edad"
              value={age === null ? "" : `${age} años`}
            />

            <CalculatedField
              label="Grupo"
              value={elementGroup?.label ?? ""}
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
              <h2 className="registrar-subtitle">Contacto responsable</h2>
            </div>

            {isAdult && (
              <fieldset className="registration-choice registration-choice--contact">
                <legend>¿Quién será el contacto?</legend>
                <div className="registration-choice__options">
                  <button
                    type="button"
                    className={selfTutor ? "is-selected" : ""}
                    onClick={enableSelfTutor}
                    disabled={loading}
                  >
                    El elemento
                    {selfTutor && <Check aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    className={!selfTutor ? "is-selected" : ""}
                    onClick={disableSelfTutor}
                    disabled={loading}
                  >
                    Otra persona
                    {!selfTutor && <Check aria-hidden="true" />}
                  </button>
                </div>
              </fieldset>
            )}

            <FloatingField
              id="tutor"
              label={selfTutor ? "Nombre del contacto" : "Nombre del tutor o responsable"}
              type="text"
              name="tutor"
              value={formData.tutor}
              onChange={handleChange}
              readOnly={selfTutor}
              required
            />

            <FloatingField
              id="telefonoTutor"
              label={selfTutor ? "Teléfono de contacto (10 dígitos)" : "Teléfono del tutor (10 dígitos)"}
              type="tel"
              name="telefonoTutor"
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

            <FloatingField
              as="textarea"
              id="enfermedades"
              label="Condiciones médicas (opcional)"
              name="enfermedades"
              value={formData.enfermedades}
              onChange={handleChange}
            />

            <div className="registrar-actions">
              <button
                type="button"
                className="registrar-button registrar-button--outline"
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
              <p className="registrar-helper-text" role="status">Toca un documento para fotografiarlo.</p>
            </div>

            <div className="document-checklist" aria-label="Documentos de inscripción">
              {REGISTRATION_DOCUMENTS.map((document) => (
                <DocumentCapture
                  key={document.key}
                  document={document}
                  file={files[document.key]}
                  loading={loading}
                  onChange={handleFileChange}
                  onRemove={removeFile}
                />
              ))}
            </div>

            <div className="registrar-actions">
              <button
                type="button"
                className="registrar-button registrar-button--outline"
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
                {loading ? "Creando expediente..." : "Crear expediente"}
              </button>
            </div>
          </>
        )}
          </form>
        </div>
      </div>
    </div>
  );
}

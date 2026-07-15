import { useEffect, useState } from "react";
import Swal from "sweetalert2";
import { registerElement } from "../services/elementsService";
import { REGISTRATION_DOCUMENTS } from "../services/registrationWebhookService";
import { PageHeader } from "../components/ui/PageHeader";
import { calculateAge, getElementGroup } from "../utils/elementGroups";
import "../styles/global.css";

const MONTH_OPTIONS = [
  { value: "01", label: "Enero" },
  { value: "02", label: "Febrero" },
  { value: "03", label: "Marzo" },
  { value: "04", label: "Abril" },
  { value: "05", label: "Mayo" },
  { value: "06", label: "Junio" },
  { value: "07", label: "Julio" },
  { value: "08", label: "Agosto" },
  { value: "09", label: "Septiembre" },
  { value: "10", label: "Octubre" },
  { value: "11", label: "Noviembre" },
  { value: "12", label: "Diciembre" },
];

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

function getDateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return { year: "", month: "", day: "" };
  return { year: match[1], month: match[2], day: match[3] };
}

function getDaysInMonth(year, month) {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  if (!numericYear || !numericMonth) return 31;
  return new Date(numericYear, numericMonth, 0).getDate();
}

function normalizeBirthDateParts(parts) {
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  const currentDay = today.getDate();
  const next = { ...parts };

  if (Number(next.year) === currentYear && Number(next.month) > currentMonth) {
    next.month = String(currentMonth).padStart(2, "0");
  }

  const daysInMonth = getDaysInMonth(next.year, next.month);
  const maxDay =
    Number(next.year) === currentYear && Number(next.month) === currentMonth
      ? Math.min(daysInMonth, currentDay)
      : daysInMonth;

  if (Number(next.day) > maxDay) {
    next.day = String(maxDay).padStart(2, "0");
  }

  return next;
}

function buildDateValue(parts) {
  const { year, month, day } = normalizeBirthDateParts(parts);
  if (!year || !month || !day) return "";
  return `${year}-${month}-${day}`;
}

function getBirthYearOptions() {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let year = currentYear; year >= currentYear - 80; year -= 1) {
    years.push(String(year));
  }
  return years;
}

function BirthDateSelector({ value, onChange }) {
  const [draftParts, setDraftParts] = useState(() => getDateParts(value));
  const parts = normalizeBirthDateParts(draftParts);
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  const currentDay = today.getDate();
  const daysInMonth = getDaysInMonth(parts.year, parts.month);
  const maxDay =
    Number(parts.year) === currentYear && Number(parts.month) === currentMonth
      ? Math.min(daysInMonth, currentDay)
      : daysInMonth;
  const birthYears = getBirthYearOptions();

  useEffect(() => {
    setDraftParts(getDateParts(value));
  }, [value]);

  const handlePartChange = (part, nextValue) => {
    const nextParts = normalizeBirthDateParts({
      ...parts,
      [part]: nextValue,
    });

    setDraftParts(nextParts);
    onChange(buildDateValue(nextParts));
  };

  return (
    <fieldset className="birth-date-selector">
      <legend>Fecha de nacimiento</legend>
      <div className="birth-date-selector__grid">
        <label>
          Día
          <select
            value={parts.day}
            onChange={(event) => handlePartChange("day", event.target.value)}
            required
          >
            <option value="">Día</option>
            {Array.from({ length: maxDay }, (_, index) => {
              const day = String(index + 1).padStart(2, "0");
              return (
                <option key={day} value={day}>
                  {index + 1}
                </option>
              );
            })}
          </select>
        </label>

        <label>
          Mes
          <select
            value={parts.month}
            onChange={(event) => handlePartChange("month", event.target.value)}
            required
          >
            <option value="">Mes</option>
            {MONTH_OPTIONS.map((month) => (
              <option
                key={month.value}
                value={month.value}
                disabled={
                  Number(parts.year) === currentYear &&
                  Number(month.value) > currentMonth
                }
              >
                {month.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Año
          <select
            value={parts.year}
            onChange={(event) => handlePartChange("year", event.target.value)}
            required
          >
            <option value="">Año</option>
            {birthYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
      </div>
    </fieldset>
  );
}

export function RegistrarElemento() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selfTutor, setSelfTutor] = useState(false);

  const [formData, setFormData] = useState(INITIAL_FORM_DATA);
  const [files, setFiles] = useState(() => createInitialFiles());

  const age = calculateAge(formData.fechaNacimiento);
  const elementGroup = getElementGroup({
    birthDate: formData.fechaNacimiento,
    sex: formData.sexo,
  });
  const isAdult = age !== null && age >= 18;
  const fullName = getFullName(formData);
  const selfTutorPhoneLocked =
    selfTutor && /^\d{10}$/.test(formData.telefonoTutor);

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
  };

  const handleFileChange = (event, key) => {
    const file = event.target.files?.[0] ?? null;

    if (file && file.type !== "application/pdf") {
      showAlert({
        icon: "error",
        title: "Archivo inválido",
        text: "Selecciona un documento en formato PDF.",
      });
      event.target.value = "";
      return;
    }

    setFiles((current) => ({
      ...current,
      [key]: file,
    }));
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

      const today = new Date().toISOString().split("T")[0];
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
  };

  const showAlert = ({ icon, title, text }) => {
    return Swal.fire({
      icon,
      title,
      text,
      confirmButtonText: "Aceptar",
      confirmButtonColor: "#FFC107",
      background: "#1B263B",
      color: "#FFFFFF",
    });
  };

  const showAlertAfterLoading = async (alertConfig) => {
    setLoading(false);
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    return showAlert(alertConfig);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const hoy = new Date().toISOString().split("T")[0];

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
      const result = await registerElement(formData, files);

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

        <div className="registration-workspace">
          <ol className="step-list" aria-label={`Paso ${step} de 3`}>
            {["Datos personales", "Tutor", "Documentos"].map((label, index) => {
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

            <FloatingField
              as="select"
              id="sexo"
              label="Sexo"
              name="sexo"
              value={formData.sexo}
              onChange={handleChange}
              required
            >
              <option value="" disabled></option>
              <option value="Masculino">Masculino</option>
              <option value="Femenino">Femenino</option>
            </FloatingField>

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

            <FloatingField
              as="textarea"
              id="enfermedades"
              label="Enfermedades o condiciones médicas (opcional)"
              name="enfermedades"
              value={formData.enfermedades}
              onChange={handleChange}
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

            {isAdult && (
              <div className="self-tutor-row">
                <button
                  type="button"
                  className="registrar-button registrar-button--secondary registrar-button--compact"
                  onClick={selfTutor ? disableSelfTutor : enableSelfTutor}
                  disabled={loading}
                >
                  {selfTutor ? "Editar tutor manualmente" : "Es su propio tutor"}
                </button>
              </div>
            )}

            <FloatingField
              id="tutor"
              label="Nombre del tutor"
              type="text"
              name="tutor"
              value={formData.tutor}
              onChange={handleChange}
              readOnly={selfTutor}
              required
            />

            <FloatingField
              id="telefonoTutor"
              label="Teléfono del tutor (10 dígitos)"
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
              readOnly={selfTutorPhoneLocked}
              pattern="[0-9]{10}"
              required
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
              <p className="registrar-helper-text" role="status">
                La inscripción puede guardarse ahora. Los documentos se podrán agregar después.
              </p>
            </div>

            <div className="document-checklist" aria-label="Documentos de inscripción">
              {REGISTRATION_DOCUMENTS.map((document) => (
                <label className="document-checklist__item" key={document.key}>
                  <span>
                    <strong>{document.label}</strong>
                    <small>
                      {files[document.key]?.name || "Selecciona PDF"}
                    </small>
                  </span>
                  <b>{files[document.key] ? "Seleccionado" : "Pendiente"}</b>
                  <input
                    type="file"
                    name={document.key}
                    accept="application/pdf"
                    onChange={(event) => handleFileChange(event, document.key)}
                    disabled={loading}
                  />
                </label>
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
                {loading ? "Enviando..." : "Enviar Registro"}
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

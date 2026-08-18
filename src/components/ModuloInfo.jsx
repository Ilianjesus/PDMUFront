import { useState, useEffect } from "react";
import { StatusMessage } from "./ui/StatusMessage";
import { Info, Pencil, Upload } from "lucide-react";
import { BirthDateSelector } from "./ui/BirthDateSelector";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import {
  setElementSelfTutor,
  updateElementField,
  uploadElementDocument,
} from "../services/elementsService";
import { calculateAge } from "../utils/elementGroups";
import "../styles/ModuloInfo.css";

function formatDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
  }).format(date);
}

function blurActiveControl() {
  const activeElement = document.activeElement;
  if (
    activeElement instanceof HTMLElement &&
    ["INPUT", "SELECT", "TEXTAREA"].includes(activeElement.tagName)
  ) {
    activeElement.blur();
  }
}

const ModuloInfo = ({ data, readOnly = false, onDataChange }) => {
  const [form, setForm] = useState({});
  const [editingField, setEditingField] = useState(null);
  const [originalValue, setOriginalValue] = useState(null);

  const [selectedFiles, setSelectedFiles] = useState({});
  const [uploading, setUploading] = useState(null);
  const [savingField, setSavingField] = useState(null);
  const [savingSelfTutor, setSavingSelfTutor] = useState(false);
  const [selfTutorDialog, setSelfTutorDialog] = useState({
    visible: false,
    guardianName: "",
    guardianPhone: "",
  });

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingField, setPendingField] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    setForm(data || {});
    setEditingField(null);
    setOriginalValue(null);
    setShowConfirmModal(false);
    setPendingField(null);
    setSelectedFiles({});
    setUploading(null);
    setSavingField(null);
    setSavingSelfTutor(false);
    setSelfTutorDialog({
      visible: false,
      guardianName: "",
      guardianPhone: "",
    });
    setMessage(null);
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
      const cleaned = value.replace(/\D/g, "");
      if (cleaned.length > 10) return;
      setForm({ ...form, [name]: cleaned });
      return;
    }

    setForm({ ...form, [name]: value });
  };

  const startEditing = (name) => {
    if (readOnly) return;
    if (editingField && editingField !== name) return;
    if (savingField) return;
    if (name === "Tutor" && form.IsSelfTutor) {
      setMessage({
        variant: "info",
        text: "El nombre del tutor se sincroniza con el elemento porque está marcado como propio tutor.",
      });
      return;
    }

    setEditingField(name);
    setOriginalValue(form[name] ?? "");
  };

  const cancelEdit = () => {
    if (!editingField || savingField) return;

    setForm((prev) => ({
      ...prev,
      [editingField]: originalValue,
    }));

    setEditingField(null);
    setOriginalValue(null);
    setPendingField(null);
    setShowConfirmModal(false);
  };

  const requestConfirmEdit = (name) => {
    if (savingField) return;
    if (name === "TelefonoTutor" && !/^\d{10}$/.test(form[name] ?? "")) {
      setMessage({
        variant: "error",
        text: "El teléfono debe contener exactamente 10 dígitos.",
      });
      return;
    }
    blurActiveControl();
    setPendingField(name);
    setShowConfirmModal(true);
  };

  const confirmEdit = async () => {
    if (!pendingField) return;

    try {
      setSavingField(pendingField);
      setMessage(null);

      const result = await updateElementField({
        elementId: form.ID,
        field: pendingField,
        value: form[pendingField],
      });

      if (!result.ok) throw new Error(result.message);
      const updatedData = result.data || form;

      setForm(updatedData);
      onDataChange?.(updatedData);

      setEditingField(null);
      setOriginalValue(null);
      setPendingField(null);
      setShowConfirmModal(false);

      setMessage({
        variant: "success",
        text: result.message || "Campo actualizado correctamente.",
      });
    } catch (err) {
      console.error("Error actualizando campo:", err);
      setMessage({
        variant: "error",
        text: err?.message || "Error al guardar el cambio.",
      });
    } finally {
      setSavingField(null);
    }
  };

  const handleFileSelect = (field, file) => {
    if (!file) return;

    if (file.type !== "application/pdf") {
      setMessage({
        variant: "error",
        text: "Selecciona un documento en formato PDF.",
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setMessage({
        variant: "error",
        text: "El documento no debe superar 10 MB.",
      });
      return;
    }

    setSelectedFiles((prev) => ({ ...prev, [field]: file }));
  };

  const cancelFile = (field) => {
    if (uploading === field) return;

    setSelectedFiles((prev) => {
      const updated = { ...prev };
      delete updated[field];
      return updated;
    });
  };

  const confirmUpload = async (field, documentType) => {
    const file = selectedFiles[field];
    if (!file) return;

    try {
      setUploading(field);
      setMessage(null);
      const result = await uploadElementDocument({
        elementId: form.ID,
        documentType,
        file,
      });

      if (!result.ok) throw new Error(result.message);
      const updatedData = result.data || form;

      setForm(updatedData);
      onDataChange?.(updatedData);

      setSelectedFiles((prev) => {
        const updated = { ...prev };
        delete updated[field];
        return updated;
      });
      setMessage({
        variant: "success",
        text: result.message || "Documento actualizado correctamente.",
      });
    } catch (err) {
      console.error("Error subiendo archivo:", err);
      setMessage({
        variant: "error",
        text: err?.message || "Error al subir el archivo.",
      });
    } finally {
      setUploading(null);
    }
  };

  const applyUpdatedElement = (updatedData) => {
    setForm(updatedData);
    onDataChange?.(updatedData);
  };

  const handleEnableSelfTutor = async () => {
    try {
      setSavingSelfTutor(true);
      setMessage(null);

      const result = await setElementSelfTutor({
        elementId: form.ID,
        enabled: true,
      });

      if (!result.ok) throw new Error(result.message);
      applyUpdatedElement(result.data || form);
      setMessage({
        variant: "success",
        text: result.message || "El elemento quedó marcado como su propio tutor.",
      });
    } catch (error) {
      console.error("Error marcando propio tutor:", error);
      setMessage({
        variant: "error",
        text: error?.message || "No se pudo marcar como propio tutor.",
      });
    } finally {
      setSavingSelfTutor(false);
    }
  };

  const openSelfTutorDialog = () => {
    setSelfTutorDialog({
      visible: true,
      guardianName: "",
      guardianPhone: "",
    });
  };

  const closeSelfTutorDialog = () => {
    if (savingSelfTutor) return;
    setSelfTutorDialog({
      visible: false,
      guardianName: "",
      guardianPhone: "",
    });
  };

  const handleSelfTutorDialogChange = (field, value) => {
    setSelfTutorDialog((current) => ({
      ...current,
      [field]:
        field === "guardianPhone"
          ? value.replace(/\D/g, "").slice(0, 10)
          : value,
    }));
  };

  const confirmDisableSelfTutor = async () => {
    if (!selfTutorDialog.guardianName.trim()) {
      setMessage({
        variant: "error",
        text: "Captura el nombre del nuevo tutor.",
      });
      return;
    }
    if (!/^\d{10}$/.test(selfTutorDialog.guardianPhone)) {
      setMessage({
        variant: "error",
        text: "El teléfono del nuevo tutor debe contener exactamente 10 dígitos.",
      });
      return;
    }

    try {
      setSavingSelfTutor(true);
      setMessage(null);

      const result = await setElementSelfTutor({
        elementId: form.ID,
        enabled: false,
        guardianName: selfTutorDialog.guardianName,
        guardianPhone: selfTutorDialog.guardianPhone,
      });

      if (!result.ok) throw new Error(result.message);
      applyUpdatedElement(result.data || form);
      setSelfTutorDialog({
        visible: false,
        guardianName: "",
        guardianPhone: "",
      });
      setMessage({
        variant: "success",
        text: result.message || "Se asignó un nuevo tutor correctamente.",
      });
    } catch (error) {
      console.error("Error desmarcando propio tutor:", error);
      setMessage({
        variant: "error",
        text: error?.message || "No se pudo asignar el nuevo tutor.",
      });
    } finally {
      setSavingSelfTutor(false);
    }
  };

  const isValidDocumentLink = (value) => {
    return (
      typeof value === "string" &&
      value.trim() !== "" &&
      value.trim().toLowerCase() !== "sin documento" &&
      /^https?:\/\//i.test(value.trim())
    );
  };

  const getDocumentRecord = (type) => {
    const documents = Array.isArray(form.documents) ? form.documents : [];
    return (
      documents.find((document) => document.type === type && document.status === "active") ||
      documents.find((document) => document.type === type) ||
      null
    );
  };

  const getDocumentUrl = (field, document) => {
    return (
      document?.downloadUrl ||
      document?.driveUrl ||
      document?.url ||
      form[field] ||
      ""
    );
  };

  const personalFields = [
    ["Nombres", "Nombre(s)"],
    ["ApellidoPaterno", "Apellido paterno"],
    ["ApellidoMaterno", "Apellido materno"],
    ["Enfermedades", "Enfermedades"],
    ["FechaNacimiento", "Fecha de nacimiento"],
    ["Sexo", "Sexo"],
  ];

  const tutorFields = [
    ["Tutor", "Nombre del tutor"],
    ["TelefonoTutor", "Teléfono del tutor"],
  ];

  const documentFields = [
    {
      field: "ineTutor",
      type: "guardian_id",
      label: "INE del tutor",
      placeholder: "PDF requerido para validar identidad del tutor.",
    },
    {
      field: "certificadoMedico",
      type: "medical_certificate",
      label: "Certificado médico",
      placeholder: "PDF requerido para validar estado médico.",
    },
    {
      field: "comprobanteDomicilio",
      type: "proof_of_address",
      label: "Comprobante de domicilio",
      placeholder: "PDF requerido para domicilio.",
    },
    {
      field: "actaNacimiento",
      type: "birth_certificate",
      label: "Acta de nacimiento",
      placeholder: "PDF requerido para identidad del elemento.",
    },
    {
      field: "curp",
      type: "curp",
      label: "CURP",
      placeholder: "PDF requerido de CURP.",
    },
    {
      field: "hojaInscripcion",
      type: "enrollment_form",
      label: "Hoja de inscripción",
      placeholder: "PDF requerido de inscripción firmada.",
    },
  ];

  const enrollments = Array.isArray(form.enrollments) ? form.enrollments : [];
  const isAdult = calculateAge(form.FechaNacimiento) >= 18;
  const selfTutorHint = form.IsSelfTutor
    ? "Tutor sincronizado"
    : isAdult
    ? "Tutor independiente"
    : "Solo mayores de edad";

  const handleSelfTutorToggle = (checked) => {
    if (checked) {
      handleEnableSelfTutor();
      return;
    }

    openSelfTutorDialog();
  };

  const renderEditableField = ([name, label]) => {
    const isEditing = editingField === name;
    const isSavingThisField = savingField === name;
    const isBirthDate = name === "FechaNacimiento";
    const isSex = name === "Sexo";
    const isSelfTutorName = name === "Tutor" && form.IsSelfTutor;
    const displayValue =
      isSex && !isEditing
        ? form[name] === "F"
          ? "Femenino"
          : form[name] === "M"
            ? "Masculino"
            : form[name] || ""
        : form[name] || "";

    return (
      <div className="form-group" key={name}>
        <label htmlFor={`field-${name}`}>{label}</label>

        <div className="field-edit-block">
          {isBirthDate && isEditing ? (
            <BirthDateSelector
              value={form[name] || ""}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  [name]: value,
                }))
              }
              disabled={!!savingField}
            />
          ) : isSex && isEditing ? (
            <select
              id={`field-${name}`}
              name={name}
              value={form[name] || ""}
              onChange={handleChange}
              disabled={!!savingField}
              className="input input-active"
            >
              <option value="M">Masculino</option>
              <option value="F">Femenino</option>
            </select>
          ) : (
            <div className="input-wrapper">
              <input
                id={`field-${name}`}
                type="text"
                name={name}
                value={displayValue}
                onChange={handleChange}
                disabled={!isEditing || !!savingField}
                className={`input ${isEditing ? "input-active" : "input-readonly"}`}
              />

              {!readOnly && !isEditing && !isSelfTutorName && (
                <button
                  type="button"
                  className="edit-icon-btn"
                  onClick={() => startEditing(name)}
                  disabled={!!savingField}
                  aria-label={`Editar ${label}`}
                >
                  <Pencil aria-hidden="true" />
                </button>
              )}
            </div>
          )}

          {isEditing && (
            <div className="field-action-row">
              <button
                type="button"
                className="field-save-btn"
                onClick={() => requestConfirmEdit(name)}
                disabled={isSavingThisField}
              >
                {isSavingThisField ? "Guardando..." : "Guardar"}
              </button>
              <button
                type="button"
                className="field-cancel-btn"
                onClick={cancelEdit}
                disabled={isSavingThisField}
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="modulo-info-container">
      <div className="module-header">
        <div>
          <div className="module-title-row">
            <h2 className="modulo-info-title">Información del elemento</h2>
            <span
              className="info-tooltip"
              tabIndex={0}
              aria-label={
                readOnly
                  ? "Consulta en modo lectura."
                  : "Edita un campo a la vez para mantener un control claro de los cambios."
              }
            >
              <Info aria-hidden="true" />
              <span className="info-tooltip__content" role="tooltip">
                {readOnly
                  ? "Consulta en modo lectura."
                  : "Edita un campo a la vez para mantener un control claro de los cambios."}
              </span>
            </span>
          </div>
        </div>
      </div>

      {message && (
        <StatusMessage variant={message.variant}>{message.text}</StatusMessage>
      )}

      <div className="modulo-info-form">
        <section className="info-section" aria-labelledby="personal-data-title">
          <div className="info-section__header">
            <div className="module-title-row">
              <h3 id="personal-data-title">Datos personales</h3>
              <span
                className="info-tooltip"
                tabIndex={0}
                aria-label="Identidad y antecedentes del elemento."
              >
                <Info aria-hidden="true" />
                <span className="info-tooltip__content" role="tooltip">
                  Identidad y antecedentes del elemento.
                </span>
              </span>
            </div>
          </div>
          <div className="info-fields-grid">
            {personalFields.map(renderEditableField)}
          </div>
        </section>

        <section className="info-section" aria-labelledby="tutor-data-title">
          <div className="info-section__header">
            <div className="module-title-row">
              <h3 id="tutor-data-title">Tutor y contacto</h3>
              <span
                className="info-tooltip"
                tabIndex={0}
                aria-label="Información de la persona responsable."
              >
                <Info aria-hidden="true" />
                <span className="info-tooltip__content" role="tooltip">
                  Información de la persona responsable.
                </span>
              </span>
            </div>
          </div>
          <div className="info-fields-grid">
            <div className={`self-tutor-control ${form.IsSelfTutor ? "is-active" : ""}`}>
              <div className="self-tutor-control__text">
                <span>Propio tutor</span>
                <strong>{form.IsSelfTutor ? "Sí" : "No"}</strong>
                <p>{selfTutorHint}</p>
              </div>
              {!readOnly && (
                <label
                  className="self-tutor-switch"
                  aria-label={
                    form.IsSelfTutor
                      ? "Desmarcar propio tutor"
                      : "Marcar como propio tutor"
                  }
                >
                  <input
                    type="checkbox"
                    checked={Boolean(form.IsSelfTutor)}
                    onChange={(event) => handleSelfTutorToggle(event.target.checked)}
                    disabled={savingSelfTutor || (!form.IsSelfTutor && !isAdult)}
                  />
                  <span aria-hidden="true" />
                </label>
              )}
            </div>
            {tutorFields.map(renderEditableField)}
          </div>
        </section>

        <section className="info-section" aria-labelledby="enrollments-title">
          <div className="info-section__header">
            <div className="module-title-row">
              <h3 id="enrollments-title">Historial de inscripciones</h3>
              <span
                className="info-tooltip"
                tabIndex={0}
                aria-label="Altas, bajas y reingresos del mismo elemento."
              >
                <Info aria-hidden="true" />
                <span className="info-tooltip__content" role="tooltip">
                  Altas, bajas y reingresos del mismo elemento.
                </span>
              </span>
            </div>
          </div>

          {enrollments.length > 0 ? (
            <div className="enrollment-history">
              {enrollments.map((enrollment) => (
                <article
                  className="enrollment-history__item"
                  key={enrollment.enrollmentId}
                >
                  <div>
                    <strong>
                      {enrollment.status === "active" ? "Inscripción activa" : "Inscripción cerrada"}
                    </strong>
                    <span>{enrollment.enrollmentCode || enrollment.enrollmentId}</span>
                  </div>
                  <dl>
                    <div>
                      <dt>Alta</dt>
                      <dd>{formatDate(enrollment.enrolledOn)}</dd>
                    </div>
                    <div>
                      <dt>Inicio de cobro</dt>
                      <dd>{formatDate(enrollment.billingStartOn)}</dd>
                    </div>
                    <div>
                      <dt>Baja</dt>
                      <dd>{formatDate(enrollment.droppedOn)}</dd>
                    </div>
                    {enrollment.dropReason && (
                      <div>
                        <dt>Motivo</dt>
                        <dd>{enrollment.dropReason}</dd>
                      </div>
                    )}
                  </dl>
                </article>
              ))}
            </div>
          ) : (
            <p className="document-missing">No hay historial de inscripciones registrado.</p>
          )}
        </section>

        <section className="info-section" aria-labelledby="documents-title">
          <div className="info-section__header">
            <div className="module-title-row">
              <h3 id="documents-title">Documentos</h3>
              <span
                className="info-tooltip"
                tabIndex={0}
                aria-label={
                  readOnly
                    ? "Muestra el estado de los documentos registrados."
                    : "Consulta documentos cargados o completa los faltantes."
                }
              >
                <Info aria-hidden="true" />
                <span className="info-tooltip__content" role="tooltip">
                  {readOnly
                    ? "Muestra el estado de los documentos registrados."
                    : "Consulta documentos cargados o completa los faltantes."}
                </span>
              </span>
            </div>
          </div>

          {readOnly ? (
            <div className="documents-grid">
              {Array.isArray(form.documents) && form.documents.length > 0 ? (
                form.documents.map((document) => (
                  <div className="form-group document-group" key={document.documentId}>
                    <span className="document-label">
                      {document.type || "Documento"}
                    </span>
                    <span className="document-missing">
                      {document.fileName || "Metadata registrada"} · {document.status || "sin estado"}
                    </span>
                  </div>
                ))
              ) : (
                <p className="document-missing">No hay metadata documental registrada.</p>
              )}
            </div>
          ) : (
          <div className="documents-grid">
          {documentFields.map(({ field, label, placeholder, type }) => {
          const document = getDocumentRecord(type);
          const documentUrl = getDocumentUrl(field, document);
          const hasDocument = isValidDocumentLink(documentUrl);
          const isUploadingThisDocument = uploading === field;

          return (
            <div className="form-group document-group" key={field}>
              <div className="document-group__header">
                <span className="document-label">{label}</span>
                <span className={`document-status ${hasDocument ? "document-status--complete" : "document-status--pending"}`}>
                  {hasDocument ? "Completo" : "Pendiente"}
                </span>
              </div>

              <div className="document-row">
                {hasDocument ? (
                  <a
                    href={documentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="document-link"
                  >
                    Ver documento
                  </a>
                ) : (
                  <span className="document-missing">{placeholder}</span>
                )}

                {!selectedFiles[field] ? (
                  <label className="upload-btn">
                    <Upload aria-hidden="true" />
                    <span>{hasDocument ? "Reemplazar" : "Subir PDF"}</span>
                    <input
                      type="file"
                      accept="application/pdf"
                      hidden
                      onChange={(e) => handleFileSelect(field, e.target.files[0])}
                    />
                  </label>
                ) : null}

                {selectedFiles[field] ? (
                  <div className="upload-confirm-box">
                    <span className="file-name">
                      {selectedFiles[field].name}
                    </span>

                    <button
                      type="button"
                      className="confirm-upload"
                      onClick={() => confirmUpload(field, type)}
                      disabled={isUploadingThisDocument}
                    >
                      {isUploadingThisDocument ? "Subiendo..." : "Confirmar"}
                    </button>

                    <button
                      type="button"
                      className="cancel-upload"
                      onClick={() => cancelFile(field)}
                      disabled={isUploadingThisDocument}
                    >
                      Cancelar
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          );
          })}
          </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={showConfirmModal}
        title="Confirmar cambios"
        message="Se actualizará este campo en el expediente del elemento."
        confirmLabel="Guardar cambio"
        busy={Boolean(savingField)}
        onConfirm={confirmEdit}
        onCancel={() => {
          if (savingField) return;
          setShowConfirmModal(false);
          setPendingField(null);
        }}
      />

      <ConfirmDialog
        open={selfTutorDialog.visible}
        title="Asignar nuevo tutor"
        message="Al guardar, el elemento dejará de estar marcado como su propio tutor."
        confirmLabel="Guardar tutor"
        busy={savingSelfTutor}
        onConfirm={confirmDisableSelfTutor}
        onCancel={closeSelfTutorDialog}
      >
        <div className="self-tutor-dialog-fields">
          <label className="self-tutor-dialog-field">
            Nombre del tutor
            <input
              type="text"
              value={selfTutorDialog.guardianName}
              onChange={(event) =>
                handleSelfTutorDialogChange("guardianName", event.target.value)
              }
              disabled={savingSelfTutor}
              autoComplete="name"
            />
          </label>

          <label className="self-tutor-dialog-field">
            Teléfono del tutor
            <input
              type="tel"
              inputMode="numeric"
              value={selfTutorDialog.guardianPhone}
              onChange={(event) =>
                handleSelfTutorDialogChange("guardianPhone", event.target.value)
              }
              disabled={savingSelfTutor}
              autoComplete="tel"
            />
          </label>
        </div>
      </ConfirmDialog>
    </div>
  );
};

export default ModuloInfo;

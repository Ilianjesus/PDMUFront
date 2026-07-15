import { useState, useEffect } from "react";
import { StatusMessage } from "./ui/StatusMessage";
import { Info } from "lucide-react";
import "../styles/ModuloInfo.css";

function unsupportedSupabaseWrite() {
  return Promise.resolve({
    ok: false,
    code: "UNSUPPORTED_OPERATION",
    message:
      "La edición de expediente y documentos aún no está habilitada en Supabase.",
  });
}

const EditIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);

const UploadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/>
    <line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
);

function formatDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
  }).format(date);
}

const ModuloInfo = ({ data, readOnly = false }) => {
  const [form, setForm] = useState({});
  const [editingField, setEditingField] = useState(null);
  const [originalValue, setOriginalValue] = useState(null);

  const [selectedFiles, setSelectedFiles] = useState({});
  const [uploading, setUploading] = useState(null);
  const [savingField, setSavingField] = useState(null);

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
    setPendingField(name);
    setShowConfirmModal(true);
  };

  const confirmEdit = async () => {
    if (!pendingField) return;

    try {
      setSavingField(pendingField);
      setMessage(null);

      const result = await unsupportedSupabaseWrite();

      if (!result.ok) throw new Error(result.message);

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

    if (isValidDocumentLink(form[field])) {
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

  const confirmUpload = async (field) => {
    const file = selectedFiles[field];
    if (!file || isValidDocumentLink(form[field])) return;

    try {
      setUploading(field);
      setMessage(null);
      const result = await unsupportedSupabaseWrite();

      if (!result.ok) throw new Error(result.message);

      const fileUrl = result.data.url;

      setForm((prev) => ({
        ...prev,
        [field]: fileUrl,
      }));

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

  const isValidDocumentLink = (value) => {
    return (
      typeof value === "string" &&
      value.trim() !== "" &&
      value.trim().toLowerCase() !== "sin documento" &&
      /^https?:\/\//i.test(value.trim())
    );
  };

  const personalFields = [
    ["Nombres", "Nombre(s)"],
    ["ApellidoPaterno", "Apellido paterno"],
    ["ApellidoMaterno", "Apellido materno"],
    ["Enfermedades", "Enfermedades"],
    ["FechaNacimiento", "Fecha de nacimiento"],
  ];

  const tutorFields = [
    ["Tutor", "Nombre del tutor"],
    ["TelefonoTutor", "Teléfono del tutor"],
  ];

  const documentFields = [
    ["ineTutor", "INE del tutor"],
    ["certificadoMedico", "Certificado médico"],
    ["comprobanteDomicilio", "Comprobante de domicilio"],
    ["actaNacimiento", "Acta de nacimiento"],
    ["curp", "CURP"],
    ["hojaInscripcion", "Hoja de inscripción"],
  ];

  const enrollments = Array.isArray(form.enrollments) ? form.enrollments : [];

  const renderEditableField = ([name, label]) => {
    const isEditing = editingField === name;
    const isSavingThisField = savingField === name;

    return (
      <div className="form-group" key={name}>
        <label htmlFor={`field-${name}`}>{label}</label>

        <div className="field-edit-block">
          <div className="input-wrapper">
            <input
              id={`field-${name}`}
              type={name === "FechaNacimiento" ? "date" : "text"}
              name={name}
              value={form[name] || ""}
              onChange={handleChange}
              disabled={!isEditing || !!savingField}
              className={`input ${isEditing ? "input-active" : "input-readonly"}`}
            />

            {!readOnly && !isEditing && (
              <button
                type="button"
                className="edit-icon-btn"
                onClick={() => startEditing(name)}
                disabled={!!savingField}
                aria-label={`Editar ${label}`}
              >
                <EditIcon />
              </button>
            )}
          </div>

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
                  ? "Consulta en modo lectura. La edición y los documentos se habilitarán en una fase posterior."
                  : "Edita un campo a la vez para mantener un control claro de los cambios."
              }
            >
              <Info aria-hidden="true" />
              <span className="info-tooltip__content" role="tooltip">
                {readOnly
                  ? "Consulta en modo lectura. La edición y los documentos se habilitarán en una fase posterior."
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
            <div className="form-group">
              <label htmlFor="field-Sexo">Sexo</label>
              <input id="field-Sexo" type="text" value={form.Sexo || ""} disabled className="input input-readonly" />
            </div>
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
                    ? "Muestra el estado de los documentos registrados. La carga y descarga se habilitará después."
                    : "Consulta documentos cargados o completa los faltantes."
                }
              >
                <Info aria-hidden="true" />
                <span className="info-tooltip__content" role="tooltip">
                  {readOnly
                    ? "Muestra el estado de los documentos registrados. La carga y descarga se habilitará después."
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
          {documentFields.map(([field, label]) => {
          const hasDocument = isValidDocumentLink(form[field]);

          return (
            <div className="form-group document-group" key={field}>
              <span className="document-label">{label}</span>

              <div className="document-row">
                {hasDocument ? (
                  <a
                    href={form[field]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="document-link"
                  >
                    Ver documento
                  </a>
                ) : (
                  <span className="document-missing">No cargado</span>
                )}

                {!hasDocument && !selectedFiles[field] ? (
                  <label className="upload-btn">
                    <UploadIcon />
                    <span className="visually-hidden">Cargar {label}</span>
                    <input
                      type="file"
                      accept="application/pdf"
                      hidden
                      onChange={(e) => handleFileSelect(field, e.target.files[0])}
                    />
                  </label>
                ) : null}

                {!hasDocument && selectedFiles[field] ? (
                  <div className="upload-confirm-box">
                    <span className="file-name">
                      {selectedFiles[field].name}
                    </span>

                    <button
                      type="button"
                      className="confirm-upload"
                      onClick={() => confirmUpload(field)}
                      disabled={uploading === field}
                    >
                      {uploading === field ? "Subiendo..." : "Confirmar"}
                    </button>

                    <button
                      type="button"
                      className="cancel-upload"
                      onClick={() => cancelFile(field)}
                      disabled={uploading === field}
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

      {showConfirmModal && (
        <div className="modal-overlay" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="edit-confirm-title" aria-describedby="edit-confirm-description">
            <h5 className="confirm-modal-title" id="edit-confirm-title">Confirmar cambios</h5>
            <p className="confirm-modal-text" id="edit-confirm-description">
              ¿Deseas guardar los cambios en este campo?
            </p>

            <div className="confirm-modal-actions">
              <button
                type="button"
                className="modal-confirm-btn"
                onClick={confirmEdit}
                disabled={!!savingField}
              >
                {savingField ? "Guardando..." : "Sí, guardar"}
              </button>
              <button
                type="button"
                className="modal-cancel-btn"
                onClick={() => {
                  if (savingField) return;
                  setShowConfirmModal(false);
                  setPendingField(null);
                }}
                disabled={!!savingField}
              >
                No, volver
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModuloInfo;

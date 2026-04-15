import { useState, useEffect } from "react";
import axios from "axios";
import "../styles/ModuloInfo.css";

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

const ModuloInfo = ({ data }) => {
  const [form, setForm] = useState({});
  const [editingField, setEditingField] = useState(null);
  const [originalValue, setOriginalValue] = useState(null);

  const [selectedFiles, setSelectedFiles] = useState({});
  const [uploading, setUploading] = useState(null);
  const [savingField, setSavingField] = useState(null);

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingField, setPendingField] = useState(null);

  useEffect(() => {
    setForm(data || {});
    setEditingField(null);
    setOriginalValue(null);
    setShowConfirmModal(false);
    setPendingField(null);
    setSelectedFiles({});
    setUploading(null);
    setSavingField(null);
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
    setPendingField(name);
    setShowConfirmModal(true);
  };

  const confirmEdit = async () => {
    if (!pendingField) return;

    try {
      setSavingField(pendingField);

      const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_UPLOAD_DOCS;

      if (!webhookUrl) {
        throw new Error("Falta la variable VITE_N8N_WEBHOOK_UPLOAD_DOCS");
      }

      const payload = {
        ID: data?.ID,
        field: pendingField,
        value: form[pendingField] ?? "",
      };

      const res = await axios.post(webhookUrl, payload);
      const result = res?.data;

      if (!res?.status || res.status < 200 || res.status >= 300) {
        throw new Error("Respuesta HTTP inválida");
      }

      if (result?.status !== "success") {
        throw new Error(result?.message || "No se pudo actualizar el campo");
      }

      setEditingField(null);
      setOriginalValue(null);
      setPendingField(null);
      setShowConfirmModal(false);

      alert(result?.message || "Campo actualizado correctamente");
    } catch (err) {
      console.error("Error actualizando campo:", err);
      alert(err?.response?.data?.message || err?.message || "Error al guardar el cambio");
    } finally {
      setSavingField(null);
    }
  };

  const handleFileSelect = (field, file) => {
    if (!file) return;

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

      const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_UPLOAD_DOCS;

      const formData = new FormData();
      formData.append("file", file);
      formData.append("documentType", field);
      formData.append("ID", data?.ID);

      const res = await axios.post(webhookUrl, formData);
      const result = res?.data;
      const fileUrl = result?.url;

      if (!res?.status || res.status < 200 || res.status >= 300) {
        throw new Error("Respuesta HTTP inválida");
      }

      if (result?.status && result.status !== "success") {
        throw new Error(result?.message || "No se pudo subir el documento");
      }

      if (!fileUrl || typeof fileUrl !== "string") {
        throw new Error("Webhook no devolvió una URL válida");
      }

      setForm((prev) => ({
        ...prev,
        [field]: fileUrl,
      }));

      cancelFile(field);
      alert(result?.message || "Documento actualizado correctamente");
    } catch (err) {
      console.error("Error subiendo archivo:", err);
      alert(err?.response?.data?.message || err?.message || "Error al subir el archivo");
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

  const editableFields = [
    ["Nombres", "Nombre(s)"],
    ["ApellidoPaterno", "Apellido paterno"],
    ["ApellidoMaterno", "Apellido materno"],
    ["Tutor", "Tutor"],
    ["Enfermedades", "Enfermedades"],
    ["TelefonoTutor", "Teléfono del tutor"],
    ["FechaNacimiento", "Fecha de nacimiento"],
  ];

  const readOnlyFields = [
    ["Sexo", "Sexo"],
  ];

  const documentFields = [
    ["ineTutor", "INE del tutor"],
    ["certificadoMedico", "Certificado médico"],
    ["comprobanteDomicilio", "Comprobante de domicilio"],
    ["actaNacimiento", "Acta de nacimiento"],
    ["curp", "CURP"],
    ["hojaInscripcion", "Hoja de inscripción"],
  ];

  return (
    <div className="modulo-info-container">
      <h4 className="modulo-info-title">Información Personal</h4>

      <div className="modulo-info-form">
        {editableFields.map(([name, label]) => {
          const isEditing = editingField === name;
          const isSavingThisField = savingField === name;

          return (
            <div className="form-group" key={name}>
              <label>{label}</label>

              <div className="field-edit-block">
                <div className="input-wrapper">
                  <input
                    type={name === "FechaNacimiento" ? "date" : "text"}
                    name={name}
                    value={form[name] || ""}
                    onChange={handleChange}
                    disabled={!isEditing || !!savingField}
                    className={`input ${
                      isEditing ? "input-active" : "input-readonly"
                    }`}
                  />

                  {!isEditing && (
                    <button
                      type="button"
                      className="edit-icon-btn"
                      onClick={() => startEditing(name)}
                      disabled={!!savingField}
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
        })}

        {readOnlyFields.map(([name, label]) => (
          <div className="form-group" key={name}>
            <label>{label}</label>
            <div className="field-edit-block">
              <div className="input-wrapper">
                <input
                  type="text"
                  name={name}
                  value={form[name] || ""}
                  disabled
                  className="input input-readonly"
                />
              </div>
            </div>
          </div>
        ))}

        <h4 className="document-section-title">Documentos</h4>

        {documentFields.map(([field, label]) => {
          const hasDocument = isValidDocumentLink(form[field]);

          return (
            <div className="form-group document-group" key={field}>
              <label>{label}</label>

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
                    <input
                      type="file"
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
                      className="confirm-upload"
                      onClick={() => confirmUpload(field)}
                      disabled={uploading === field}
                    >
                      {uploading === field ? "Subiendo..." : "Confirmar"}
                    </button>

                    <button
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

      {showConfirmModal && (
        <div className="modal-overlay">
          <div className="confirm-modal">
            <h5 className="confirm-modal-title">Confirmar cambios</h5>
            <p className="confirm-modal-text">
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
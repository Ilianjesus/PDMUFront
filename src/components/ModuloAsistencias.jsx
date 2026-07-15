import { useEffect, useMemo, useState } from "react";
import {
  cancelAttendance,
  createAttendanceException,
  getAttendanceStatement,
} from "../services/attendanceService";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { EmptyState } from "./ui/EmptyState";
import { StatusMessage } from "./ui/StatusMessage";
import "../styles/ModuloAsistencias.css";

const EMPTY_DELETE = {
  record: null,
  reason: "",
};

const EMPTY_EXCEPTION = {
  weekday: "0",
  startsOn: new Date().toISOString().split("T")[0],
  endsOn: "",
  reason: "",
};

function formatDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(date);
}

function formatTime(value) {
  return value ? value.slice(0, 5) : "";
}

function sessionTime(session) {
  const start = formatTime(session.startsAt);
  const end = formatTime(session.endsAt);
  if (start && end) return `${start}-${end}`;
  return start || "Sin horario";
}

function recordKey(record, index) {
  return record?.row_number ?? record?.attendanceId ?? `${record?.FechaHora}-${index}`;
}

const ModuloAsistencias = ({ data }) => {
  const [statement, setStatement] = useState(data);
  const [pendingDelete, setPendingDelete] = useState(EMPTY_DELETE);
  const [exceptionForm, setExceptionForm] = useState(EMPTY_EXCEPTION);
  const [deleting, setDeleting] = useState(false);
  const [savingException, setSavingException] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    setStatement(data);
    setMessage(null);
    setPendingDelete(EMPTY_DELETE);
    setExceptionForm(EMPTY_EXCEPTION);
  }, [data]);

  useEffect(() => {
    // keep filters in sync when the statement data changes
    setFromFilter(data?.from ?? "");
    setToFilter(data?.to ?? "");
  }, [data]);

  const sessions = useMemo(
    () => (Array.isArray(statement?.sessions) ? statement.sessions : []),
    [statement]
  );
  const exceptions = Array.isArray(statement?.exceptions) ? statement.exceptions : [];
  const records = Array.isArray(statement?.records) ? statement.records : [];
  const summary = statement?.summary ?? {};

  const [fromFilter, setFromFilter] = useState(statement?.from ?? "");
  const [toFilter, setToFilter] = useState(statement?.to ?? "");
  const [typeFilter, setTypeFilter] = useState("all");

  const filteredSessions = useMemo(() => {
    const from = fromFilter ? new Date(`${fromFilter}T00:00:00`) : null;
    const to = toFilter ? new Date(`${toFilter}T23:59:59`) : null;

    return sessions.filter((session) => {
      const date = session.sessionDate ? new Date(`${session.sessionDate}T00:00:00`) : null;

      if (from && date && date < from) return false;
      if (to && date && date > to) return false;

      if (typeFilter === "all") return true;

      // Map our simple filters to session.statementStatus values
      const mapping = {
        present: "present",
        absent: "absent",
        excused: "excused",
      };

      return session.statementStatus === mapping[typeFilter];
    });
  }, [sessions, fromFilter, toFilter, typeFilter]);

  const refreshStatement = async () => {
    const elementId = statement?.["ID Elemento"];
    if (!elementId) return;

    const result = await getAttendanceStatement({
      elementId,
      from: statement.from,
      to: statement.to,
      elementName: statement["Nombre Elemento"],
    });
    if (!result.ok) throw new Error(result.message);
    setStatement(result.data);
  };

  const updateCancelledRecord = (attendanceId, reason) => {
    setStatement((current) => {
      if (!current) return current;

      const updateRecord = (record) =>
        record?.row_number === attendanceId
          ? {
              ...record,
              recordStatus: "cancelled",
              cancelReason: reason,
            }
          : record;

      return {
        ...current,
        records: current.records?.map(updateRecord) ?? [],
        Asistencias: current.Asistencias?.map(updateRecord) ?? [],
        sessions:
          current.sessions?.map((session) =>
            session.attendance?.row_number === attendanceId
              ? {
                  ...session,
                  attendance: updateRecord(session.attendance),
                }
              : session
          ) ?? [],
      };
    });
  };

  const handleEliminar = async () => {
    if (!pendingDelete.record) return;
    if (!pendingDelete.reason.trim()) {
      setMessage({
        variant: "error",
        text: "Captura el motivo de cancelación.",
      });
      return;
    }

    try {
      setDeleting(true);
      setMessage(null);
      const result = await cancelAttendance({
        attendanceId: pendingDelete.record.row_number,
        expectedVersion: pendingDelete.record.version,
        reason: pendingDelete.reason,
      });

      if (!result.ok) throw new Error(result.message);

      updateCancelledRecord(
        pendingDelete.record.row_number,
        pendingDelete.reason
      );
      setPendingDelete(EMPTY_DELETE);
      setMessage({
        variant: "success",
        text: result.message || "Asistencia cancelada correctamente.",
      });
    } catch (error) {
      console.error("Error cancelando asistencia:", error);
      setMessage({
        variant: "error",
        text: error?.message || "Error al cancelar la asistencia.",
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleCreateException = async () => {
    if (!exceptionForm.reason.trim()) {
      setMessage({
        variant: "error",
        text: "Captura el motivo de la exención.",
      });
      return;
    }

    try {
      setSavingException(true);
      setMessage(null);
      const result = await createAttendanceException({
        elementId: statement?.["ID Elemento"],
        scope: "weekday",
        weekday: Number(exceptionForm.weekday),
        startsOn: exceptionForm.startsOn,
        endsOn: exceptionForm.endsOn || null,
        reason: exceptionForm.reason,
      });

      if (!result.ok) throw new Error(result.message);

      await refreshStatement();
      setExceptionForm(EMPTY_EXCEPTION);
      setMessage({
        variant: "success",
        text: result.message || "Exención registrada correctamente.",
      });
    } catch (error) {
      console.error("Error creando exención:", error);
      setMessage({
        variant: "error",
        text: error?.message || "No se pudo registrar la exención.",
      });
    } finally {
      setSavingException(false);
    }
  };

  const renderSessionList = (items, emptyText) => {
    if (items.length === 0) {
      return <p className="attendance-empty-line">{emptyText}</p>;
    }

    return (
      <div className="attendance-session-list">
        {items.map((session) => (
          <article
            className={`attendance-session-row attendance-session-row--${session.statementStatus}`}
            key={session.sessionId}
          >
            <div>
              <strong>{session.activityName}</strong>
              <span>
                {formatDate(session.sessionDate)} · {sessionTime(session)}
                {session.location ? ` · ${session.location}` : ""}
              </span>
            </div>
            <span className={`attendance-badge attendance-badge--${session.statementStatus}`}>
              {session.statementStatusLabel}
            </span>
            <div className="attendance-session-row__meta">
              <span>{session.categoryLabel}</span>
              {session.attendance?.source && <span>{session.attendance.Tipo}</span>}
            </div>
            <div className="attendance-actions">
              {session.attendance && session.attendance.recordStatus !== "cancelled" && (
                <button
                  type="button"
                  className="attendance-delete"
                  onClick={() =>
                    setPendingDelete({
                      record: session.attendance,
                      reason: "",
                    })
                  }
                >
                  Cancelar
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    );
  };

  return (
    <section className="attendance-module" aria-labelledby="attendance-history-title">
      <div className="module-header attendance-module-header">
        <div>
          <span>Control de asistencia</span>
          <h2 id="attendance-history-title">Estado de asistencia</h2>
        </div>
        <div className="attendance-header-controls">
          <span className="attendance-info" title="Las faltas se calculan contra sesiones obligatorias aplicables, restando exenciones y registros válidos.">ℹ️</span>
          <div className="attendance-filters">
            <label>
              Desde
              <input
                type="date"
                value={fromFilter}
                onChange={(e) => setFromFilter(e.target.value)}
              />
            </label>
            <label>
              Hasta
              <input
                type="date"
                value={toFilter}
                onChange={(e) => setToFilter(e.target.value)}
              />
            </label>
            <label>
              Mostrar
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="all">Todas</option>
                <option value="present">Asistencias</option>
                <option value="absent">Faltas</option>
                <option value="excused">Justificadas</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      {statement && (
        <div className="attendance-overview attendance-overview--simple">
          <div><span>Periodo</span><strong>{formatDate(statement.from)} - {formatDate(statement.to)}</strong></div>
          <div><span>Asistencias</span><strong>{summary.presentCount ?? 0}</strong></div>
          <div><span>Faltas</span><strong>{summary.absentCount ?? 0}</strong></div>
          <div><span>Justificadas</span><strong>{summary.excusedCount ?? 0}</strong></div>
        </div>
      )}

      {message && (
        <StatusMessage variant={message.variant}>{message.text}</StatusMessage>
      )}

      {!sessions.length && !records.length ? (
        <EmptyState
          title="Sin sesiones registradas"
          description="No hay sesiones o registros disponibles para este periodo."
        />
      ) : (
        <div className="attendance-statement">
          <section>
            <h3>Sesiones</h3>
            {renderSessionList(
              filteredSessions,
              "No hay sesiones en este periodo y filtro seleccionados."
            )}
          </section>

          <section>
            <h3>Exenciones activas</h3>
            <div className="attendance-exception-form">
              <label>
                Día obligatorio
                <select
                  value={exceptionForm.weekday}
                  onChange={(event) =>
                    setExceptionForm((current) => ({
                      ...current,
                      weekday: event.target.value,
                    }))
                  }
                  disabled={savingException}
                >
                  <option value="3">Miércoles</option>
                  <option value="6">Sábado</option>
                  <option value="0">Domingo</option>
                </select>
              </label>
              <label>
                Desde
                <input
                  type="date"
                  value={exceptionForm.startsOn}
                  onChange={(event) =>
                    setExceptionForm((current) => ({
                      ...current,
                      startsOn: event.target.value,
                    }))
                  }
                  disabled={savingException}
                />
              </label>
              <label>
                Hasta
                <input
                  type="date"
                  value={exceptionForm.endsOn}
                  onChange={(event) =>
                    setExceptionForm((current) => ({
                      ...current,
                      endsOn: event.target.value,
                    }))
                  }
                  disabled={savingException}
                />
              </label>
              <label>
                Motivo
                <input
                  type="text"
                  value={exceptionForm.reason}
                  onChange={(event) =>
                    setExceptionForm((current) => ({
                      ...current,
                      reason: event.target.value,
                    }))
                  }
                  disabled={savingException}
                />
              </label>
              <button
                type="button"
                className="attendance-save"
                onClick={handleCreateException}
                disabled={savingException}
              >
                {savingException ? "Guardando..." : "Agregar exención"}
              </button>
            </div>
            {exceptions.length === 0 ? (
              <p className="attendance-empty-line">Sin exenciones activas en este periodo.</p>
            ) : (
              <div className="attendance-exception-list">
                {exceptions.map((exception) => (
                  <article key={exception.exceptionId}>
                    <strong>{exception.reason}</strong>
                    <span>
                      {exception.scope}
                      {exception.weekday !== null ? ` · día ${exception.weekday}` : ""}
                      · desde {formatDate(exception.startsOn)}
                      {exception.endsOn ? ` hasta ${formatDate(exception.endsOn)}` : ""}
                    </span>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3>Historial crudo</h3>
            {records.length === 0 ? (
              <p className="attendance-empty-line">Sin registros capturados.</p>
            ) : (
              <div className="attendance-table-scroll">
                <table className="attendance-table">
                  <thead>
                    <tr>
                      <th>Fecha y hora</th>
                      <th>Estado</th>
                      <th>Origen</th>
                      <th>Sesión</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record, index) => {
                      const key = recordKey(record, index);
                      const isCancelled = record.recordStatus === "cancelled";

                      return (
                        <tr key={key}>
                          <td>{record.FechaHora}</td>
                          <td>{record.Estado}{isCancelled ? " · Cancelada" : ""}</td>
                          <td>{record.Tipo}</td>
                          <td>{record.activityName || record.sessionId || "Registro legacy"}</td>
                          <td>
                            <div className="attendance-actions">
                              <button
                                type="button"
                                className="attendance-delete"
                                onClick={() =>
                                  setPendingDelete({
                                    record,
                                    reason: "",
                                  })
                                }
                                disabled={isCancelled}
                              >
                                Cancelar
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete.record}
        title="Cancelar asistencia"
        message="¿Deseas cancelar este registro? La cancelación será lógica y quedará auditada."
        confirmLabel="Cancelar asistencia"
        destructive
        busy={deleting}
        onCancel={() => !deleting && setPendingDelete(EMPTY_DELETE)}
        onConfirm={handleEliminar}
      >
        <label className="attendance-cancel-reason">
          Motivo
          <textarea
            value={pendingDelete.reason}
            onChange={(event) =>
              setPendingDelete((current) => ({
                ...current,
                reason: event.target.value,
              }))
            }
            rows={3}
            disabled={deleting}
          />
        </label>
      </ConfirmDialog>
    </section>
  );
};

export default ModuloAsistencias;

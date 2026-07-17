import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Buscador from "../components/Buscador";
import { LoadingState } from "../components/ui/LoadingState";
import { StatusMessage } from "../components/ui/StatusMessage";
import { PageHeader } from "../components/ui/PageHeader";
import {
  createActivitySession,
  listActivitySessions,
  registerAttendance,
  saveAttendanceActivity,
} from "../services/attendanceService";
import { ChevronLeft, ChevronRight, ScanLine, X } from "lucide-react";
import "../styles/global.css";

const ATTENDANCE_TYPES = [
  { id: "instruccion", label: "Instrucción", category: "mandatory" },
  { id: "natacion", label: "Natación", category: "activity" },
  { id: "atletismo", label: "Atletismo", category: "activity" },
  { id: "personalizado", label: "Personalizado", category: "event" },
];

function toInputDate(date) {
  return date.toISOString().split("T")[0];
}

function todayInputValue() {
  return toInputDate(new Date());
}

function monthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function getMonthBounds(date) {
  const start = monthStart(date);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return {
    start: toInputDate(start),
    end: toInputDate(end),
  };
}

function buildCalendarDays(monthDate) {
  const first = monthStart(monthDate);
  const daysInMonth = new Date(
    monthDate.getFullYear(),
    monthDate.getMonth() + 1,
    0
  ).getDate();
  const leading = first.getDay();
  const days = [];

  for (let index = 0; index < leading; index += 1) {
    days.push({ key: `empty-${index}`, empty: true });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
    days.push({
      key: toInputDate(date),
      date: toInputDate(date),
      day,
    });
  }

  return days;
}

function formatLongDate(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatMonth(date) {
  return new Intl.DateTimeFormat("es-MX", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function getSessionLabel(session) {
  if (!session) return "";
  return `${session.activityName} · ${formatLongDate(session.sessionDate)}`;
}

function sessionCategoryClass(session) {
  const normalizedName = normalizeSessionName(session?.activityName);

  if (normalizedName.includes("instruccion")) {
    return "attendance-session-chip--instruction";
  }
  if (normalizedName.includes("natacion")) {
    return "attendance-session-chip--swimming";
  }
  if (normalizedName.includes("atletismo")) {
    return "attendance-session-chip--athletics";
  }

  return `attendance-session-chip--${session?.category ?? "activity"}`;
}

function normalizeSessionName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getSessionUniqueKey(session) {
  return `${session?.activityId || normalizeSessionName(session?.activityName)}-${
    session?.sessionDate || ""
  }`;
}

function uniqueSessionsByActivityDate(daySessions) {
  const seen = new Set();
  return daySessions.filter((session) => {
    const key = getSessionUniqueKey(session);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const INITIAL_TYPE_FORM = {
  type: "instruccion",
  customName: "",
  required: true,
};

export function RegistrarAsistencia() {
  const [currentMonth, setCurrentMonth] = useState(monthStart(new Date()));
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mensaje, setMensaje] = useState(null);
  const [typeModalDate, setTypeModalDate] = useState(null);
  const [historyModalDate, setHistoryModalDate] = useState(null);
  const [typeForm, setTypeForm] = useState(INITIAL_TYPE_FORM);
  const [attendanceSession, setAttendanceSession] = useState(null);
  const [elementoSeleccionado, setElementoSeleccionado] = useState(null);
  const [attendanceSearchResetKey, setAttendanceSearchResetKey] = useState(0);
  const [attendanceStatus, setAttendanceStatus] = useState("present");
  const [busy, setBusy] = useState(false);

  const today = todayInputValue();
  const calendarDays = useMemo(() => buildCalendarDays(currentMonth), [currentMonth]);
  const sessionsByDate = useMemo(
    () =>
      sessions.reduce((groups, session) => {
        groups[session.sessionDate] = groups[session.sessionDate] || [];
        groups[session.sessionDate].push(session);
        return groups;
      }, {}),
    [sessions]
  );

  const selectedType = ATTENDANCE_TYPES.find((type) => type.id === typeForm.type);
  const modalDaySessions = useMemo(
    () => (typeModalDate ? sessionsByDate[typeModalDate] ?? [] : []),
    [sessionsByDate, typeModalDate]
  );
  const modalDayUniqueSessions = useMemo(
    () => uniqueSessionsByActivityDate(modalDaySessions),
    [modalDaySessions]
  );
  const historyDaySessions = useMemo(
    () => (historyModalDate ? sessionsByDate[historyModalDate] ?? [] : []),
    [historyModalDate, sessionsByDate]
  );
  const historyDayUniqueSessions = useMemo(
    () => uniqueSessionsByActivityDate(historyDaySessions),
    [historyDaySessions]
  );
  const typeName =
    typeForm.type === "personalizado"
      ? typeForm.customName.trim()
      : selectedType?.label ?? "";

  const loadSessions = useCallback(async () => {
    try {
      setLoading(true);
      const bounds = getMonthBounds(currentMonth);
      const result = await listActivitySessions({
        from: bounds.start,
        to: bounds.end,
      });

      if (!result.ok) throw new Error(result.message);
      setSessions(result.data);
    } catch (error) {
      console.error("Error cargando calendario de asistencia:", error);
      setMensaje({
        tipo: "error",
        texto: error?.message || "No se pudo cargar el calendario.",
      });
    } finally {
      setLoading(false);
    }
  }, [currentMonth]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const openTypeModal = (date) => {
    if (date > today) return;
    if (date < today) {
      setHistoryModalDate(date);
      setMensaje(null);
      return;
    }

    setTypeModalDate(date);
    setTypeForm({
      ...INITIAL_TYPE_FORM,
      required: true,
    });
    setMensaje(null);
  };

  const closeTypeModal = () => {
    if (busy) return;
    setTypeModalDate(null);
  };

  const closeHistoryModal = () => {
    setHistoryModalDate(null);
  };

  const closeAttendanceModal = () => {
    if (busy) return;
    setAttendanceSession(null);
    setElementoSeleccionado(null);
    setAttendanceSearchResetKey((current) => current + 1);
    setAttendanceStatus("present");
  };

  const openAttendanceSession = (session) => {
    setAttendanceSession(session);
    setElementoSeleccionado(null);
    setAttendanceSearchResetKey((current) => current + 1);
    setAttendanceStatus("present");
    setTypeModalDate(null);
  };

  const handleCreateSessionFromType = async () => {
    if (!typeModalDate || !typeName) {
      setMensaje({
        tipo: "error",
        texto: "Selecciona o captura el tipo de asistencia.",
      });
      return;
    }

    try {
      setBusy(true);
      setMensaje(null);

      const existingSession = modalDaySessions.find(
        (session) =>
          normalizeSessionName(session.activityName) === normalizeSessionName(typeName)
      );

      if (existingSession) {
        openAttendanceSession(existingSession);
        return;
      }

      const activityResult = await saveAttendanceActivity({
        name: typeName,
        category: selectedType?.category ?? "activity",
      });

      if (!activityResult.ok) throw new Error(activityResult.message);

      const existingByActivityId = modalDaySessions.find(
        (session) => session.activityId === activityResult.data.activityId
      );

      if (existingByActivityId) {
        openAttendanceSession(existingByActivityId);
        return;
      }

      const sessionResult = await createActivitySession({
        activityId: activityResult.data.activityId,
        sessionDate: typeModalDate,
        attendanceScope: typeForm.required ? "all_active" : "open",
        attendanceRequired: typeForm.required,
        status: "open",
      });

      if (!sessionResult.ok) throw new Error(sessionResult.message);

      await loadSessions();
      setAttendanceSession({
        sessionId: sessionResult.data?.sessionId ?? sessionResult.data?.session?.sessionId,
        activityName: typeName,
        sessionDate: typeModalDate,
        startsAt: "",
        categoryLabel: typeForm.required ? "Obligatoria" : "Extra",
      });
      setElementoSeleccionado(null);
      setAttendanceSearchResetKey((current) => current + 1);
      setAttendanceStatus("present");
      setTypeModalDate(null);
    } catch (error) {
      console.error("Error creando sesión:", error);
      setMensaje({
        tipo: "error",
        texto: error?.message || "No se pudo crear la sesión.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterAttendance = async () => {
    if (!attendanceSession?.sessionId) {
      setMensaje({ tipo: "error", texto: "Selecciona una sesión válida." });
      return;
    }
    if (!elementoSeleccionado?.ID) {
      setMensaje({
        tipo: "error",
        texto: "Busca y selecciona el elemento antes de registrar.",
      });
      return;
    }

    try {
      setBusy(true);
      setMensaje(null);
      const result = await registerAttendance({
        elementId: elementoSeleccionado.ID,
        sessionId: attendanceSession.sessionId,
        status: attendanceStatus,
        source: "manual",
      });

      if (!result.ok) throw new Error(result.message);

      setElementoSeleccionado(null);
      setAttendanceSearchResetKey((current) => current + 1);
      setAttendanceStatus("present");
      setMensaje({
        tipo: "exito",
        texto: `Asistencia registrada en ${attendanceSession.activityName}.`,
      });
    } catch (error) {
      console.error("Error registrando asistencia:", error);
      setMensaje({
        tipo: "error",
        texto: error?.message || "No se pudo registrar la asistencia.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="attendance-entry page-shell">
      <div className="page-shell__inner">
        <PageHeader
          eyebrow="Control de asistencia"
          title="Asistencias"
          infoTooltip="Selecciona un día del calendario, define el tipo y registra por búsqueda o QR."
        />

        {mensaje && (
          <StatusMessage variant={mensaje.tipo === "exito" ? "success" : "error"}>
            {mensaje.texto}
          </StatusMessage>
        )}

        <section className="attendance-calendar" aria-label="Calendario de asistencias">
          <div className="attendance-calendar__toolbar">
            <button
              type="button"
              className="ui-button ui-button--secondary"
              onClick={() => setCurrentMonth((month) => addMonths(month, -1))}
              aria-label="Mes anterior"
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <div>
              <h2>{formatMonth(currentMonth)}</h2>
              <span>Hoy: {formatLongDate(today)}</span>
            </div>
            <button
              type="button"
              className="ui-button ui-button--secondary"
              onClick={() => setCurrentMonth((month) => addMonths(month, 1))}
              aria-label="Mes siguiente"
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </div>

          <div className="attendance-calendar__weekdays" aria-hidden="true">
            {["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          {loading ? (
            <LoadingState compact label="Cargando calendario..." />
          ) : (
            <div className="attendance-calendar__grid">
              {calendarDays.map((day) => {
                if (day.empty) return <div className="attendance-calendar__empty" key={day.key} />;

                const daySessions = sessionsByDate[day.date] ?? [];
                const uniqueDaySessions = uniqueSessionsByActivityDate(daySessions);
                const isFuture = day.date > today;
                const isPast = day.date < today;
                return (
                  <button
                    type="button"
                    className={`attendance-calendar-day${day.date === today ? " today" : ""}${isPast ? " past" : ""}${isFuture ? " future" : ""}`}
                    key={day.key}
                    disabled={isFuture}
                    onClick={() => openTypeModal(day.date)}
                    aria-label={
                      isFuture
                        ? `${formatLongDate(day.date)} no disponible`
                        : isPast
                        ? `Ver registro de ${formatLongDate(day.date)}`
                        : `Registrar asistencia de ${formatLongDate(day.date)}`
                    }
                  >
                    <span>{day.day}</span>
                    <div>
                      {uniqueDaySessions.slice(0, 3).map((session) => (
                        <small
                          className={`attendance-session-chip ${sessionCategoryClass(session)}`}
                          key={session.sessionId}
                        >
                          {session.activityName}
                        </small>
                      ))}
                      {uniqueDaySessions.length > 3 && (
                        <small className="attendance-session-chip">
                          +{uniqueDaySessions.length - 3}
                        </small>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {historyModalDate && (
          <div className="attendance-modal-overlay" role="presentation">
            <section
              className="attendance-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="attendance-history-title"
            >
              <button
                type="button"
                className="attendance-modal__close"
                onClick={closeHistoryModal}
                aria-label="Cerrar"
              >
                <X aria-hidden="true" />
              </button>

              <div className="attendance-modal__header">
                <span>{formatLongDate(historyModalDate)}</span>
                <h2 id="attendance-history-title">Registro del día</h2>
              </div>

              <div className="attendance-day-stats">
                <div>
                  <span>Eventos</span>
                  <strong>{historyDayUniqueSessions.length}</strong>
                </div>
                <div>
                  <span>Obligatorias</span>
                  <strong>
                    {historyDayUniqueSessions.filter((session) => session.attendanceRequired).length}
                  </strong>
                </div>
              </div>

              {historyDayUniqueSessions.length === 0 ? (
                <p className="attendance-history-empty">
                  No hay sesiones registradas para este día.
                </p>
              ) : (
                <div className="attendance-existing-sessions attendance-existing-sessions--readonly">
                  {historyDayUniqueSessions.map((session) => (
                    <article key={session.sessionId}>
                      <span
                        className={`attendance-session-dot ${sessionCategoryClass(session)}`}
                        aria-hidden="true"
                      />
                      <div>
                        <strong>{session.activityName}</strong>
                        <small>
                          {session.categoryLabel}
                          {session.attendanceRequired ? " · obligatoria" : " · extra"}
                        </small>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {typeModalDate && (
          <div className="attendance-modal-overlay" role="presentation">
            <section
              className="attendance-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="attendance-type-title"
            >
              <button
                type="button"
                className="attendance-modal__close"
                onClick={closeTypeModal}
                aria-label="Cerrar"
              >
                <X aria-hidden="true" />
              </button>

              <div className="attendance-modal__header">
                <span>{formatLongDate(typeModalDate)}</span>
                <h2 id="attendance-type-title">Tipo de asistencia</h2>
              </div>

              {modalDayUniqueSessions.length > 0 && (
                <div className="attendance-existing-sessions">
                  <h3>Sesiones de este día</h3>
                  {modalDayUniqueSessions.map((session) => (
                    <button
                      type="button"
                      key={session.sessionId}
                      onClick={() => openAttendanceSession(session)}
                    >
                      <span
                        className={`attendance-session-dot ${sessionCategoryClass(session)}`}
                        aria-hidden="true"
                      />
                      <strong>{session.activityName}</strong>
                      <small>{session.categoryLabel}</small>
                    </button>
                  ))}
                </div>
              )}

              <div className="attendance-type-grid">
                {ATTENDANCE_TYPES.map((type) => (
                  <button
                    type="button"
                    className={`attendance-type-option${typeForm.type === type.id ? " active" : ""}`}
                    key={type.id}
                    onClick={() =>
                      setTypeForm((current) => ({
                        ...current,
                        type: type.id,
                        required: type.category === "mandatory",
                      }))
                    }
                  >
                    {type.label}
                  </button>
                ))}
              </div>

              {typeForm.type === "personalizado" && (
                <label className="field-label" htmlFor="custom-attendance-name">
                  Nombre del evento
                  <input
                    id="custom-attendance-name"
                    className="control"
                    value={typeForm.customName}
                    onChange={(event) =>
                      setTypeForm((current) => ({
                        ...current,
                        customName: event.target.value,
                      }))
                    }
                    placeholder="Ej. Servicio, carrera, práctica especial"
                  />
                </label>
              )}

              <label className="attendance-required-toggle">
                <input
                  type="checkbox"
                  checked={typeForm.required}
                  onChange={(event) =>
                    setTypeForm((current) => ({
                      ...current,
                      required: event.target.checked,
                    }))
                  }
                />
                <span>Cuenta como obligatoria</span>
              </label>

              <button
                type="button"
                className="button attendance-modal__primary"
                onClick={handleCreateSessionFromType}
                disabled={busy || !typeName}
              >
                {busy ? "Abriendo..." : "Abrir registro"}
              </button>
            </section>
          </div>
        )}

        {attendanceSession && (
          <div className="attendance-modal-overlay" role="presentation">
            <section
              className="attendance-modal attendance-modal--wide"
              role="dialog"
              aria-modal="true"
              aria-labelledby="attendance-register-title"
            >
              <button
                type="button"
                className="attendance-modal__close"
                onClick={closeAttendanceModal}
                aria-label="Cerrar"
              >
                <X aria-hidden="true" />
              </button>

              <div className="attendance-modal__header">
                <span>{getSessionLabel(attendanceSession)}</span>
                <h2 id="attendance-register-title">Registrar asistencia</h2>
              </div>

              <div className="attendance-register-actions">
                <Link
                  className="ui-button"
                  to={`/Scanner?session=${attendanceSession.sessionId}`}
                >
                  <ScanLine aria-hidden="true" />
                  Escanear QR
                </Link>
                <select
                  className="control"
                  value={attendanceStatus}
                  onChange={(event) => setAttendanceStatus(event.target.value)}
                >
                  <option value="present">Asistencia</option>
                  <option value="late">Retardo</option>
                  <option value="excused">Justificada</option>
                </select>
              </div>

              <Buscador
                placeholder="Buscar por nombre o código"
                resetSignal={attendanceSearchResetKey}
                onSeleccionar={(item) => {
                  setElementoSeleccionado(item);
                  setMensaje(null);
                }}
              />

              <div className="attendance-selected-element">
                {elementoSeleccionado ? (
                  <>
                    <span>Elemento seleccionado</span>
                    <strong>
                      {elementoSeleccionado.displayName || elementoSeleccionado.Nombre}
                    </strong>
                  </>
                ) : (
                  <span>Selecciona un elemento desde el buscador.</span>
                )}
              </div>

              <div className="attendance-manual-grid attendance-manual-grid--single">
                <button
                  type="button"
                  className="button attendance-entry__submit"
                  onClick={handleRegisterAttendance}
                  disabled={busy || !elementoSeleccionado}
                >
                  {busy ? "Registrando..." : "Registrar"}
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

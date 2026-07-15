import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  listActivitySessions,
  registerAttendance,
} from "../services/attendanceService";
import { StatusMessage } from "./ui/StatusMessage";
import { PageHeader } from "./ui/PageHeader";
import { Camera, CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import "../styles/Scanner.css";

const CAMERA_START_TIMEOUT_MS = 12000;

function createScannerTargetId() {
  if (globalThis.crypto?.randomUUID) {
    return `reader-${globalThis.crypto.randomUUID()}`;
  }

  return `reader-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isCameraSecureContext() {
  if (typeof window === "undefined") return true;
  const { hostname } = window.location;
  return (
    window.isSecureContext ||
    hostname === "localhost" ||
    hostname === "127.0.0.1"
  );
}

function getCameraErrorMessage(error) {
  const name = error?.name || "";
  const message = String(error?.message || error || "").toLowerCase();

  if (name === "NotAllowedError" || message.includes("permission")) {
    return "No se pudo usar la cámara. Revisa que el permiso esté autorizado para este sitio.";
  }

  if (name === "NotFoundError" || message.includes("requested device not found")) {
    return "No se encontró una cámara disponible en este dispositivo.";
  }

  if (name === "NotReadableError" || message.includes("could not start video source")) {
    return "La cámara está ocupada por otra aplicación o el navegador no pudo iniciarla.";
  }

  if (message.includes("insecure") || message.includes("secure context")) {
    return "La cámara en móvil requiere abrir la app con HTTPS o desde localhost.";
  }

  return "No se pudo iniciar la cámara. Revisa permisos e intenta de nuevo.";
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(
      () => reject(new Error("La cámara tardó demasiado en responder.")),
      timeoutMs
    );
  });

  return Promise.race([promise, timeout]).finally(() => {
    window.clearTimeout(timer);
  });
}

export function Scanner() {
  const [scanResults, setScanResults] = useState([]);
  const [scanning, setScanning] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [startingCamera, setStartingCamera] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [searchParams] = useSearchParams();
  const scannerTargetId = useRef(createScannerTargetId());
  const scannerRef = useRef(null);
  const pendingCodes = useRef(new Set());
  const sentCodes = useRef(new Set());

  const selectedSession = sessions.find(
    (session) => session.sessionId === selectedSessionId
  );

  useEffect(() => {
    async function loadSessions() {
      try {
        setLoadingSessions(true);
        const today = new Date().toISOString().split("T")[0];
        const next = new Date();
        next.setDate(next.getDate() + 14);

        const result = await listActivitySessions({
          from: today,
          to: next.toISOString().split("T")[0],
        });

        if (!result.ok) throw new Error(result.message);

        const querySessionId = searchParams.get("session");
        setSessions(result.data);
        setSelectedSessionId(
          result.data.some((session) => session.sessionId === querySessionId)
            ? querySessionId
            : result.data[0]?.sessionId ?? ""
        );
      } catch (error) {
        console.error("No se pudieron cargar sesiones:", error);
        setScannerError(error?.message || "No se pudieron cargar las sesiones.");
      } finally {
        setLoadingSessions(false);
      }
    }

    loadSessions();
  }, [searchParams]);

  const handleScanSuccess = useCallback(async (result) => {
    const normalizedResult = String(result).trim();
    if (
      !normalizedResult ||
      pendingCodes.current.has(normalizedResult) ||
      sentCodes.current.has(normalizedResult)
    ) return;

    pendingCodes.current.add(normalizedResult);
    setScanning(false);
    setProcessing(true);
    setScannerError("");

    try {
      if (!selectedSessionId) {
        throw new Error("Selecciona una sesión antes de registrar asistencia.");
      }

      const attendanceResult = await registerAttendance({
        identifier: normalizedResult,
        sessionId: selectedSessionId,
        status: "present",
        source: "qr",
      });

      if (!attendanceResult.ok) {
        setScanResults((prev) => [
          ...prev,
          { id: normalizedResult, status: "Fallido" },
        ]);
        setScannerError(attendanceResult.message);
        return;
      }

      sentCodes.current.add(normalizedResult);
      setScanResults((prev) => [
        ...prev,
        {
          id:
            attendanceResult.data?.matchedElement?.displayName ||
            attendanceResult.data?.attendanceCode ||
            normalizedResult,
          status: "Enviado",
        },
      ]);
    } catch (err) {
      console.error("No se pudo registrar el escaneo:", err);
      setScanResults((prev) => [
        ...prev,
        { id: normalizedResult, status: "Fallido" },
      ]);
      setScannerError("Error al registrar el escaneo. Puedes intentar de nuevo.");
    } finally {
      pendingCodes.current.delete(normalizedResult);
      setProcessing(false);
    }
  }, [selectedSessionId]);

  const handleScanError = useCallback(() => undefined, []);

  useEffect(() => {
    let cancelled = false;

    async function stopScanner() {
      const scanner = scannerRef.current;
      scannerRef.current = null;

      if (!scanner) return;

      try {
        await scanner.stop();
      } catch {
        // html5-qrcode rechaza stop() si todavía no empezó; clear() igual limpia el contenedor.
      }

      try {
        scanner.clear();
      } catch (err) {
        console.error("Error al detener scanner:", err);
      }
    }

    async function initScanner() {
      if (!isCameraSecureContext()) {
        setScannerError("La cámara en móvil requiere abrir la app con HTTPS o desde localhost.");
        setScanning(false);
        setStartingCamera(false);
        return;
      }

      try {
        await stopScanner();
        if (cancelled) return;

        setStartingCamera(true);
        setScannerError("");

        const html5QrCode = new Html5Qrcode(scannerTargetId.current, {
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        });
        scannerRef.current = html5QrCode;

        const config = {
          fps: 8,
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const size = Math.floor(Math.min(280, minEdge * 0.72));
            return { width: size, height: size };
          },
          aspectRatio: 1,
          disableFlip: true,
        };

        await withTimeout(html5QrCode.start(
          { facingMode: { ideal: "environment" } },
          config,
          handleScanSuccess,
          handleScanError
        ), CAMERA_START_TIMEOUT_MS);
      } catch (err) {
        console.warn("No se pudo abrir la cámara trasera, intentando fallback...", err);

        try {
          const html5QrCode = scannerRef.current;
          if (!html5QrCode || cancelled) return;

          const devices = await Html5Qrcode.getCameras();
          if (!devices || devices.length === 0) {
            setScannerError("No se encontró ninguna cámara en el dispositivo.");
            setScanning(false);
            return;
          }

          await withTimeout(html5QrCode.start(
            { deviceId: { exact: devices[0].id } },
            { fps: 8, qrbox: { width: 240, height: 240 }, aspectRatio: 1 },
            handleScanSuccess,
            handleScanError
          ), CAMERA_START_TIMEOUT_MS);
        } catch (err2) {
          console.error("Error al iniciar el scanner:", err2);
          setScannerError(getCameraErrorMessage(err2));
          setScanning(false);
        }
      } finally {
        if (!cancelled) setStartingCamera(false);
      }
    }

    if (scanning && selectedSessionId && !loadingSessions) initScanner();

    return () => {
      cancelled = true;
      setStartingCamera(false);
      stopScanner();
    };
  }, [scanning, selectedSessionId, loadingSessions, handleScanSuccess, handleScanError]);

  function restartScanner() {
    setScannerError("");
    setProcessing(false);
    setStartingCamera(false);
    setScanning(true);
  }

  return (
    <div className="scanner-container page-shell">
      <div className="page-shell__inner">
        <PageHeader
          eyebrow="Control de asistencia"
          title="Escáner QR"
          description="Alinea el código dentro del marco. El registro se procesa automáticamente al detectarlo."
        />

        <div className="scanner-layout">
          <section className="scanner-card" aria-labelledby="scanner-status-title">
            <div className="scanner-card__status">
              <Camera aria-hidden="true" />
              <div>
                <h2 id="scanner-status-title">
                  {processing
                    ? "Procesando registro"
                    : startingCamera
                    ? "Activando cámara"
                    : scanning
                    ? "Cámara activa"
                    : "Escaneo finalizado"}
                </h2>
                <p>
                  {processing
                    ? "Espera mientras confirmamos la asistencia."
                    : startingCamera
                    ? "Autoriza el permiso de cámara si el navegador lo solicita."
                    : scanning
                    ? selectedSession
                      ? `Sesión: ${selectedSession.activityName} · ${selectedSession.sessionDate}`
                      : "Selecciona una sesión antes de escanear."
                    : "Puedes iniciar un nuevo escaneo cuando estés listo."}
                </p>
              </div>
            </div>

            <StatusMessage variant="error">{scannerError}</StatusMessage>

            <label className="field-label" htmlFor="scanner-session">
              Sesión
              <select
                id="scanner-session"
                className="control"
                value={selectedSessionId}
                onChange={(event) => {
                  setSelectedSessionId(event.target.value);
                  sentCodes.current.clear();
                  pendingCodes.current.clear();
                  setScanResults([]);
                  setScannerError("");
                  setScanning(true);
                }}
                disabled={processing || loadingSessions}
              >
                <option value="">Seleccionar sesión</option>
                {sessions.map((session) => (
                  <option key={session.sessionId} value={session.sessionId}>
                    {session.activityName} · {session.sessionDate}
                    {session.startsAt ? ` · ${session.startsAt.slice(0, 5)}` : ""}
                  </option>
                ))}
              </select>
            </label>

            {loadingSessions ? (
              <div className="scanner-processing" role="status" aria-live="polite">
                <span className="loading-state__spinner" aria-hidden="true" />
                Cargando sesiones...
              </div>
            ) : !selectedSessionId ? (
              <div className="scanner-processing" role="status" aria-live="polite">
                Selecciona una sesión para activar la cámara.
              </div>
            ) : scanning ? (
              <div className="scanner-box-wrap">
                {startingCamera && (
                  <div className="scanner-camera-overlay" role="status" aria-live="polite">
                    <span className="loading-state__spinner" aria-hidden="true" />
                    Abriendo cámara...
                  </div>
                )}
                <div
                  id={scannerTargetId.current}
                  className="scanner-box"
                  aria-label="Lector de código QR"
                />
              </div>
            ) : processing ? (
              <div className="scanner-processing" role="status" aria-live="polite">
                <span className="loading-state__spinner" aria-hidden="true" />
                Validando con el sistema...
              </div>
            ) : (
              <button type="button" onClick={restartScanner} className="ui-button scanner-restart">
                <RotateCcw aria-hidden="true" />
                Realizar otro escaneo
              </button>
            )}
          </section>

          <section className="scanner-results" aria-labelledby="scanner-results-title">
            <div className="scanner-results__header">
              <h2 id="scanner-results-title">Actividad de la sesión</h2>
              <span>{scanResults.length} registros</span>
            </div>
            {scanResults.length === 0 ? (
              <p className="scanner-results__empty">Los resultados aparecerán aquí después del primer escaneo.</p>
            ) : (
              <ul className="results-list">
                {scanResults.map((res, idx) => (
                  <li key={`${res.id}-${idx}`}>
                    {res.status === "Enviado" ? (
                      <CheckCircle2 aria-hidden="true" />
                    ) : (
                      <XCircle aria-hidden="true" />
                    )}
                    <span><strong>{res.id}</strong><small>Registro de asistencia</small></span>
                    <span className={`result-badge ${res.status === "Enviado" ? "result-badge--success" : "result-badge--error"}`}>
                      {res.status === "Enviado" ? "Registrado" : "Fallido"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

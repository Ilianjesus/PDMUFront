import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  listActivitySessions,
  registerAttendance,
} from "../services/attendanceService";
import { StatusMessage } from "./ui/StatusMessage";
import { PageHeader } from "./ui/PageHeader";
import { Camera, CheckCircle2, Play, RotateCcw, ScanLine, XCircle } from "lucide-react";
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

function canUseCameraApi() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
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

  if (name === "OverconstrainedError" || message.includes("constraint")) {
    return "No se pudo usar la cámara solicitada. Intenta de nuevo o revisa los permisos del navegador.";
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
  const navigate = useNavigate();
  const [scanResults, setScanResults] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [hasStartedScan, setHasStartedScan] = useState(false);
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
  const processingRef = useRef(false);
  const autoStartAttempted = useRef(false);

  const selectedSession = sessions.find(
    (session) => session.sessionId === selectedSessionId
  );

  const stopScanner = useCallback(async () => {
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
  }, []);

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
      processingRef.current ||
      pendingCodes.current.has(normalizedResult) ||
      sentCodes.current.has(normalizedResult)
    ) return;

    processingRef.current = true;
    pendingCodes.current.add(normalizedResult);
    setProcessing(true);
    setScannerError("");

    try {
      scannerRef.current?.pause(true);
    } catch {
      // Algunos navegadores entregan el resultado cuando el lector ya está en pausa.
    }

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
          { id: normalizedResult, status: "Fallido" },
          ...prev,
        ]);
        setScannerError(attendanceResult.message);
        return;
      }

      sentCodes.current.add(normalizedResult);
      setScanResults((prev) => [
        {
          id:
            attendanceResult.data?.matchedElement?.displayName ||
            attendanceResult.data?.attendanceCode ||
            normalizedResult,
          status: "Enviado",
        },
        ...prev,
      ]);
    } catch (err) {
      console.error("No se pudo registrar el escaneo:", err);
      setScanResults((prev) => [
        { id: normalizedResult, status: "Fallido" },
        ...prev,
      ]);
      setScannerError("Error al registrar el escaneo. Puedes intentar de nuevo.");
    } finally {
      pendingCodes.current.delete(normalizedResult);
      processingRef.current = false;
      setProcessing(false);
      window.setTimeout(() => {
        try {
          scannerRef.current?.resume();
        } catch {
          // Si la cámara se cerró, el botón de reintento permanece disponible.
        }
      }, 450);
    }
  }, [selectedSessionId]);

  const handleScanError = useCallback(() => undefined, []);

  const startScanner = useCallback(async () => {
    if (startingCamera || processing) return;

    if (!selectedSessionId) {
      setScannerError("Selecciona una sesión antes de activar la cámara.");
      return;
    }

    if (!isCameraSecureContext()) {
      setScannerError("La cámara en móvil requiere abrir la app con HTTPS o desde localhost.");
      setScanning(false);
      setStartingCamera(false);
      return;
    }

    if (!canUseCameraApi()) {
      setScannerError("Este navegador no permite usar la cámara desde esta vista. Abre el enlace directamente en Safari o Chrome.");
      setScanning(false);
      setStartingCamera(false);
      return;
    }

    const config = {
      fps: 8,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
        const size = Math.floor(Math.min(280, minEdge * 0.72));
        return { width: size, height: size };
      },
      disableFlip: true,
    };

    try {
      await stopScanner();
      setHasStartedScan(true);
      setScanning(true);
      setStartingCamera(true);
      setScannerError("");

      const html5QrCode = new Html5Qrcode(scannerTargetId.current, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      });
      scannerRef.current = html5QrCode;

      try {
        await withTimeout(
          html5QrCode.start(
            { facingMode: "environment" },
            config,
            handleScanSuccess,
            handleScanError
          ),
          CAMERA_START_TIMEOUT_MS
        );
        return;
      } catch (primaryError) {
        console.warn("No se pudo abrir la cámara trasera, intentando fallback...", primaryError);
      }

      const devices = await Html5Qrcode.getCameras();
      if (!devices || devices.length === 0) {
        throw new DOMException("No camera devices found", "NotFoundError");
      }

      const preferredDevice =
        devices.find((device) => /back|rear|environment|trasera/i.test(device.label)) ||
        devices[devices.length - 1];

      await withTimeout(
        html5QrCode.start(
          { deviceId: { exact: preferredDevice.id } },
          config,
          handleScanSuccess,
          handleScanError
        ),
        CAMERA_START_TIMEOUT_MS
      );
    } catch (err) {
      console.error("Error al iniciar el scanner:", err);
      await stopScanner();
      setScannerError(getCameraErrorMessage(err));
      setScanning(false);
    } finally {
      setStartingCamera(false);
    }
  }, [
    handleScanError,
    handleScanSuccess,
    processing,
    selectedSessionId,
    startingCamera,
    stopScanner,
  ]);

  useEffect(() => {
    const shouldAutoStart = searchParams.get("autostart") === "1";
    if (
      !shouldAutoStart ||
      autoStartAttempted.current ||
      loadingSessions ||
      !selectedSessionId
    ) return;

    autoStartAttempted.current = true;
    void startScanner();
  }, [loadingSessions, searchParams, selectedSessionId, startScanner]);

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

  function restartScanner() {
    setProcessing(false);
    startScanner();
  }

  return (
    <div className="scanner-container page-shell">
      <div className="page-shell__inner">
        <PageHeader
          title="Tomar asistencia"
          description="Escanea los códigos uno tras otro."
          onBack={() => navigate("/asistencia")}
          backLabel="Volver a asistencia"
        />

        <div className="scanner-layout">
          <section className="scanner-card" aria-labelledby="scanner-status-title">
            <div className="scanner-card__status">
              <Camera aria-hidden="true" />
              <div>
                <h2 id="scanner-status-title">
                  {processing
                    ? "Registrando"
                    : startingCamera
                    ? "Activando cámara"
                    : scanning
                    ? "Listo para escanear"
                    : hasStartedScan
                    ? "Escaneo finalizado"
                    : "Escáner listo"}
                </h2>
                <p>
                  {processing
                    ? "Mantén la cámara apuntando al siguiente código."
                    : startingCamera
                    ? "Autoriza el permiso de cámara si el navegador lo solicita."
                    : scanning
                      ? selectedSession
                      ? `${selectedSession.activityName} · ${selectedSession.sessionDate}`
                      : "Selecciona una sesión antes de escanear."
                    : hasStartedScan
                    ? "Puedes iniciar un nuevo escaneo cuando estés listo."
                    : "Activa la cámara cuando estés listo para escanear."}
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
                  setHasStartedScan(false);
                  setScanning(false);
                  stopScanner();
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
            ) : (
              <div className="scanner-box-wrap">
                {startingCamera && (
                  <div className="scanner-camera-overlay" role="status" aria-live="polite">
                    <span className="loading-state__spinner" aria-hidden="true" />
                    Abriendo cámara...
                  </div>
                )}
                {!scanning && !startingCamera && (
                  <div className="scanner-camera-overlay scanner-camera-overlay--idle">
                    <button type="button" onClick={restartScanner} className="ui-button scanner-restart">
                      {hasStartedScan ? (
                        <RotateCcw aria-hidden="true" />
                      ) : (
                        <Play aria-hidden="true" />
                      )}
                      {hasStartedScan ? "Realizar otro escaneo" : "Activar cámara"}
                    </button>
                  </div>
                )}
                {processing && (
                  <div className="scanner-feedback" role="status" aria-live="polite">
                    <span className="loading-state__spinner" aria-hidden="true" />
                    Registrando...
                  </div>
                )}
                <div
                  id={scannerTargetId.current}
                  className="scanner-box"
                  aria-label="Lector de código QR"
                />
              </div>
            )}
          </section>

          <section className="scanner-results" aria-labelledby="scanner-results-title">
            <div className="scanner-results__header">
              <div>
                <h2 id="scanner-results-title">Registrados</h2>
                <span>{selectedSession?.activityName || "Sesión actual"}</span>
              </div>
              <strong>{scanResults.length}</strong>
            </div>
            {scanResults.length === 0 ? (
              <div className="scanner-results__empty">
                <ScanLine aria-hidden="true" />
                <span>El primer registro aparecerá aquí.</span>
              </div>
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

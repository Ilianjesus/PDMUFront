import { Html5Qrcode } from "html5-qrcode";
import { useEffect, useState } from "react";
import "../styles/global.css";

export function Scanner() {
  const [scanResults, setScanResults] = useState([]);
  const [scanning, setScanning] = useState(true);

  const url = import.meta.env.VITE_N8N_WEBHOOK_ASISTENCIA;

  useEffect(() => {
    let html5QrCode;

    async function initScanner() {
      try {
        html5QrCode = new Html5Qrcode("reader");

        await html5QrCode.start(
          { facingMode: "environment" },
          { fps: 5, qrbox: { width: 250, height: 250 } },
          success,
          error
        );
      } catch (err) {
        console.warn("No se pudo abrir la cámara trasera, intentando fallback...", err);

        try {
          const devices = await Html5Qrcode.getCameras();
          if (!devices || devices.length === 0) {
            alert("No se encontró ninguna cámara en el dispositivo.");
            return;
          }

          await html5QrCode.start(
            { deviceId: { exact: devices[0].id } },
            { fps: 5, qrbox: { width: 250, height: 250 } },
            success,
            error
          );
        } catch (err2) {
          console.error("Error al iniciar el scanner:", err2);
          alert("No se pudo acceder a la cámara. Revisa permisos.");
        }
      }
    }

    if (scanning) initScanner();

    return () => {
      if (html5QrCode) {
        html5QrCode
          .stop()
          .then(() => html5QrCode.clear())
          .catch((err) => console.error("Error al detener scanner:", err));
      }
    };
  }, [scanning]);

  async function success(result) {
    if (scanResults.find((r) => r.id === result && r.status === "Enviado"))
      return;
  
    setScanning(false);
  
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ID: result }),
      });
  
      if (!response.ok)
        throw new Error("Error en la solicitud: " + response.statusText);
  
      setScanResults((prev) => [
        ...prev,
        { id: result, status: "Enviado" },
      ]);
    } catch (err) {
      console.error("No se pudo enviar al webhook:", err);
      setScanResults((prev) => [
        ...prev,
        { id: result, status: "Fallido" },
      ]);
      alert("Error al registrar el escaneo. Puedes intentar de nuevo.");
    }
  }
  

  function error(err) {
    console.warn(err);
  }

  function restartScanner() {
    setScanning(true);
  }

  return (
    <div className="scanner-container">
      <h1 className="scanner-title">Escanea tu asistencia</h1>
      {scanning ? (
        <div id="reader" className="scanner-box"></div>
      ) : (
        <button onClick={restartScanner} className="button">
          Realizar otro escaneo
        </button>
      )}

      <h2 className="results-title">Resultados escaneados:</h2>
      <ul className="results-list">
        {scanResults.map((res, idx) => (
          <li
            key={idx}
            className={
              res.status === "Enviado" ? "resultado-exito" : "resultado-error"
            }
          >
            {res.id} - {res.status}
          </li>
        ))}
      </ul>
    </div>
  );
}

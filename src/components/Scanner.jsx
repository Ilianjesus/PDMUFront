import { Html5Qrcode } from "html5-qrcode";
import { useEffect, useState } from "react";
import "../styles/global.css";

export function Scanner() {
  const [scanResults, setScanResults] = useState([]);
  const [scanning, setScanning] = useState(true);

  useEffect(() => {
    let html5QrCode;

    async function initScanner() {
      try {
        html5QrCode = new Html5Qrcode("reader");

        // Detectar si es iOS Safari
        const isIOS =
          /iPad|iPhone|iPod/.test(navigator.userAgent) &&
          !window.MSStream;

        if (isIOS) {
          // 🔹 En iOS usamos facingMode directamente
          await html5QrCode.start(
            { facingMode: { exact: "environment" } },
            { fps: 10, qrbox: { width: 250, height: 250 } },
            success,
            error
          );
        } else {
          // 🔹 En Android/otros navegadores, usamos getCameras
          const devices = await Html5Qrcode.getCameras();

          if (!devices || devices.length === 0) {
            alert("No se encontró ninguna cámara en el dispositivo.");
            return;
          }

          const backCamera = devices.find((d) =>
            d.label.toLowerCase().includes("back")
          );

          const cameraId = backCamera ? backCamera.id : devices[0].id;

          await html5QrCode.start(
            { deviceId: { exact: cameraId } },
            { fps: 5, qrbox: { width: 250, height: 250 } },
            success,
            error
          );
        }
      } catch (err) {
        console.error("Error al iniciar el scanner:", err);
        alert(
          "No se pudo acceder a la cámara. Revisa los permisos en tu navegador."
        );
      }
    }

    if (scanning) {
      initScanner();
    }

    return () => {
      if (html5QrCode) {
        html5QrCode
          .stop()
          .then(() => html5QrCode.clear())
          .catch((err) =>
            console.error("Error al detener/limpiar scanner:", err)
          );
      }
    };
  }, [scanning]);

  async function success(result) {
    if (scanResults.find((r) => r.id === result && r.status === "Enviado"))
      return;

    setScanning(false);

    try {
      const response = await fetch(
        "https://n8n.scolaris.com.mx/webhook-test/265eb356-cb2b-48e9-b49b-59540a7fd28f",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ID: result }),
        }
      );

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
              res.status === "Enviado"
                ? "resultado-exito"
                : "resultado-error"
            }
          >
            {res.id} - {res.status}
          </li>
        ))}
      </ul>
    </div>
  );
}

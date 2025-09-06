import { Html5Qrcode } from "html5-qrcode";
import { useEffect, useState } from "react";
import "../styles/global.css";

export function Scanner() {
  const [scanResults, setScanResults] = useState([]);
  const [scanner, setScanner] = useState(null);

  useEffect(() => {
    async function initScanner() {
      try {
        // Pedir permisos a la cámara
        await navigator.mediaDevices.getUserMedia({ video: true });

        const html5QrCode = new Html5Qrcode("reader");

        // Intentar abrir la cámara trasera
        const cameras = await Html5Qrcode.getCameras();
        if (cameras && cameras.length) {
          const backCamera = cameras.find((cam) =>
            cam.label.toLowerCase().includes("back")
          );

          const cameraId = backCamera ? backCamera.id : cameras[0].id;

          await html5QrCode.start(
            cameraId,
            {
              fps: 10,
              qrbox: { width: 250, height: 250 },
            },
            success,
            error
          );

          setScanner(html5QrCode);
        }
      } catch (err) {
        console.error("No se pudo iniciar el escáner:", err);
        alert("Error: No se pudo acceder a la cámara.");
      }
    }

    initScanner();

    return () => {
      if (scanner) {
        scanner.stop().catch((err) =>
          console.error("Error al detener scanner:", err)
        );
      }
    };
  }, []);

  async function success(result) {
    if (scanResults.find((r) => r.id === result && r.status === "Enviado"))
      return;

    try {
      const response = await fetch(
        "https://n8n.scolaris.com.mx/webhook-test/265eb356-cb2b-48e9-b49b-59540a7fd28f",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ID: result }),
        }
      );

      if (!response.ok)
        throw new Error("Error en la solicitud: " + response.statusText);

      setScanResults((prev) => [...prev, { id: result, status: "Enviado" }]);
    } catch (err) {
      console.error("No se pudo enviar al webhook:", err);
      setScanResults((prev) => [...prev, { id: result, status: "Fallido" }]);
      alert("Error al registrar el escaneo. Puedes intentar de nuevo.");
    }
  }

  function error(err) {
    console.warn(err);
  }

  return (
    <div className="scanner-container">
      <h1 className="scanner-title">Escanea tu asistencia</h1>

      <div id="reader" className="scanner-box"></div>

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

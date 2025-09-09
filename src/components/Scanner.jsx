import { Html5Qrcode } from "html5-qrcode";
import { useEffect, useState } from "react";
import "../styles/global.css";

export function Scanner() {
  const [scanResults, setScanResults] = useState([]);
  const [scanner, setScanner] = useState(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    async function initScanner() {
      try {
        // ✅ Pedir permisos de cámara
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        stream.getTracks().forEach((track) => track.stop()); // liberamos stream (solo pedimos permiso)

        // ✅ Obtener las cámaras disponibles
        const devices = await Html5Qrcode.getCameras();
        if (devices && devices.length) {
          // Buscar cámara trasera
          const backCamera =
            devices.find((d) =>
              d.label.toLowerCase().includes("back")
            ) || devices[0];

          const html5QrCode = new Html5Qrcode("reader");
          setScanner(html5QrCode);

          // ✅ Iniciar escaneo automáticamente
          await html5QrCode.start(
            { deviceId: { exact: backCamera.id } },
            { fps: 5, qrbox: { width: 250, height: 250 } },
            success,
            error
          );

          setScanning(true);
        }
      } catch (err) {
        console.error("No se pudo iniciar el escáner:", err);
        alert("Error al acceder a la cámara");
      }
    }

    initScanner();

    // Cleanup al desmontar
    return () => {
      if (scanner) {
        scanner.stop().catch(() => {});
        scanner.clear().catch(() => {});
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
    console.warn("Escaneo fallido:", err);
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

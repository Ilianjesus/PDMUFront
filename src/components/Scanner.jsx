import { Html5Qrcode } from "html5-qrcode";
import { useEffect, useState } from "react";
import "../styles/global.css";

export function Scanner() {
  const [scanResults, setScanResults] = useState([]);
  const [scanner, setScanner] = useState(null);

  useEffect(() => {
    async function initScanner() {
      try {
        await navigator.mediaDevices.getUserMedia({ video: true });

        const html5QrCode = new Html5Qrcode("reader");

        await html5QrCode.start(
          { facingMode: { exact: "environment" } },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          success,
          error
        );

        setScanner(html5QrCode);
      } catch (err) {
        console.error("No se pudo iniciar el escáner:", err);
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
    // Si ya se procesó este ID, no volver a procesar
    if (scanResults.find((r) => r.id === result)) return;

    // Guardar como "Procesando"
    setScanResults((prev) => [...prev, { id: result, status: "Procesando" }]);

    try {
      const response = await fetch(
        "https://n8n.scolaris.com.mx/webhook-test/265eb356-cb2b-48e9-b49b-59540a7fd28f",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ID: result }),
        }
      );

      if (!response.ok) throw new Error("Error en la solicitud");

      // ✅ Actualizar el estado a "Enviado"
      setScanResults((prev) =>
        prev.map((r) =>
          r.id === result ? { ...r, status: "Enviado" } : r
        )
      );

      // Pausar un momento el escáner para evitar bucle
      if (scanner) {
        scanner.pause();
        setTimeout(() => scanner.resume(), 2000);
      }
    } catch (err) {
      console.error("No se pudo enviar al webhook:", err);

      // ❌ Actualizar el estado a "Fallido"
      setScanResults((prev) =>
        prev.map((r) =>
          r.id === result ? { ...r, status: "Fallido" } : r
        )
      );
    }
  }

  function error(err) {
    console.warn("Scanner error:", err);
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
                : res.status === "Procesando"
                ? "resultado-procesando"
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

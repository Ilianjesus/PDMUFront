import { Html5QrcodeScanner } from "html5-qrcode";
import { useEffect, useState } from "react";

export function Scanner() {
    const [scanResults, setScanResults] = useState([]); 
    const [scanning, setScanning] = useState(true);

    useEffect(() => {
        if (scanning) {
            const newScanner = new Html5QrcodeScanner("reader", {
                qrbox: { width: 250, height: 250 },
                fps: 5,
            });

            newScanner.render(success, error);

            return () => {
                newScanner.clear().catch(err =>
                    console.error("Error al limpiar scanner:", err)
                );
            };
        }
    }, [scanning]);

    async function success(result) {
        // Evitar duplicados solo si ya se envió correctamente
        if (scanResults.find(r => r.id === result && r.status === "Enviado")) return;

        setScanning(false); // detener el escáner mientras se envía

        try {
            const response = await fetch(
                "https://eurusdeveloper.app.n8n.cloud/webhook-test/265eb356-cb2b-48e9-b49b-59540a7fd28f",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ID: result }),
                }
            );

            if (!response.ok) {
                throw new Error("Error en la solicitud: " + response.statusText);
            }

            // Solo agregar a la lista si fue exitoso
            setScanResults(prev => [...prev, { id: result, status: "Enviado" }]);
            console.log("Datos enviados correctamente:", result);
        } catch (err) {
            console.error("No se pudo enviar al webhook:", err);
            setScanResults(prev => [...prev, { id: result, status: "Fallido" }]);
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
        <div>
            <h1>Escanea tu asistencia</h1>

            {scanning ? (
                <div id="reader"></div>
            ) : (
                <button onClick={restartScanner} style={{ margin: "10px 0" }}>
                    Realizar otro escaneo
                </button>
            )}

            <h2>Resultados escaneados:::</h2>
            <ul>
                {scanResults.map((res, idx) => (
                    <li key={idx}>
                        {res.id} - {res.status}
                    </li>
                ))}
            </ul>
        </div>
    );
}

import { Html5QrcodeScanner } from "html5-qrcode";
import { useEffect, useState } from "react";

export function Scanner() {
    const [scanResults, setScanResults] = useState([]);
    const [scanner, setScanner] = useState(null);
    const [scanning, setScanning] = useState(true);

    useEffect(() => {
        if (scanning) {
            const newScanner = new Html5QrcodeScanner("reader", {
                qrbox: { width: 250, height: 250 },
                fps: 5,
            });

            newScanner.render(success, error);
            setScanner(newScanner);

            return () => {
                newScanner.clear().catch(err =>
                    console.error("Error al limpiar scanner:", err)
                );
            };
        }
    }, [scanning]);

    async function success(result) {
        if (!scanResults.includes(result)) {
            setScanResults((prev) => [...prev, result]);
            setScanning(false); // detener el escaneo después de un resultado válido

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
                    throw new Error("Error en la solicitud " + response.statusText);
                }

                console.log("Datos enviados correctamente:", result);
            } catch (err) {
                console.error("Error al enviar los datos: ", err);
            }
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
                <button onClick={restartScanner}>
                    Realizar otro escaneo
                </button>
            )}

            <h2>Resultados escaneados:</h2>
            <ul>
                {scanResults.map((res, idx) => (
                    <li key={idx}>{res}</li>
                ))}
            </ul>
        </div>
    );
}

import { Html5QrcodeScanner } from "html5-qrcode";
import { useEffect, useState } from "react";

export function Scanner() {
    const [scanResults, setScanResults] = useState([]); 

    useEffect(() => {
        const scanner = new Html5QrcodeScanner("reader", {
            qrbox: {
                width: 250,
                height: 250
            },
            fps: 5,
        });

        scanner.render(success, error);

        async function success(result) {
            // Verificar si ya fue escaneado para evitar duplicados
            if (!scanResults.includes(result)) {
                setScanResults((prev) => [...prev, result]);

                // Enviar al webhook
                try {
                    const response = await fetch(
                        "https://eurusdeveloper.app.n8n.cloud/webhook-test/265eb356-cb2b-48e9-b49b-59540a7fd28f",
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                            },
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

        return () => {
            scanner.clear().catch(err => console.error("Error al limpiar scanner:", err));
        };
    }, [scanResults]);

    return (
        <div>
            <h1>Escanea tu asistencia</h1>
            <div id="reader"></div>

            <h2>Resultados escaneados:</h2>
            <ul>
                {scanResults.map((res, idx) => (
                    <li key={idx}>{res}</li>
                ))}
            </ul>
        </div>
    );
}

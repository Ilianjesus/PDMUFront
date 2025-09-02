import { useState } from "react";
import { Link } from "react-router-dom";

export function RegistrarAsistencia() {
  const [ID, setID] = useState("");

  const enviarAsistencia = async () => {
    if (!ID.trim()) {
      alert("Por favor ingrese un ID válido");
      return;
    }

    try {
      const response = await fetch("https://eurusdeveloper.app.n8n.cloud/webhook-test/265eb356-cb2b-48e9-b49b-59540a7fd28f", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ID: ID }),
      });

      if (response.ok) {
        const data = await response.json().catch(() => {});
        alert("Asistencia registrada correctamente");
        console.log(data);
      } else {
        alert("Error al registrar la asistencia. Código: " + response.status);
      }
    } catch (error) {
      alert("Error al registrar la asistencia");
      console.error("Error:", error);
    }
  };

  return (
    <div>
        <div>
        <h2>Registrar Asistencia</h2>
        <input
        type="text"
        placeholder="Ingrese su ID"
        value={ID}
        onChange={(e) => setID(e.target.value)}
        />
        <button onClick={enviarAsistencia}>Registrar</button>
        </div>

        <Link to="/Scanner">
        <button>Escanear QR</button>
        </Link>
    </div>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import "../styles/global.css"; // usamos el mismo CSS global

export function RegistrarAsistencia() {
  const [ID, setID] = useState("");
  const [mensaje, setMensaje] = useState(null);

  const enviarAsistencia = async () => {
    if (!ID.trim()) {
      setMensaje({ tipo: "error", texto: "Por favor ingrese un ID válido" });
      return;
    }

    try {
      const response = await fetch(
        "https://n8n.scolaris.com.mx/webhook-test/265eb356-cb2b-48e9-b49b-59540a7fd28f",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ID }),
        }
      );

      if (response.ok) {
        await response.json().catch(() => {});
        setMensaje({ tipo: "exito", texto: "✅ Asistencia registrada correctamente" });
        setID("");
      } else {
        setMensaje({ tipo: "error", texto: "❌ Error al registrar. Código: " + response.status });
      }
    } catch (error) {
      console.error("Error:", error);
      setMensaje({ tipo: "error", texto: "⚠️ Error al registrar la asistencia" });
    }

    setTimeout(() => setMensaje(null), 3000);
  };

  return (
    <div className="registrar-container">
      <h2 className="registrar-title">Registrar Asistencia</h2>

      <input
        type="text"
        placeholder="Ingrese su ID"
        value={ID}
        onChange={(e) => setID(e.target.value)}
        className="login-input"
      />

      <button onClick={enviarAsistencia} className="button">
        Registrar
      </button>

      {mensaje && (
        <p className={mensaje.tipo === "exito" ? "mensaje-exito" : "mensaje-error"}>
          {mensaje.texto}
        </p>
      )}

      <Link to="/Scanner" className="link-button">
        <button className="button">Escanear QR</button>
      </Link>
    </div>
  );
}

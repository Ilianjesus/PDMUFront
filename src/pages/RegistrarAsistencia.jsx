import { useState } from "react";
import { Link } from "react-router-dom";

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
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ID }),
        }
      );

      if (response.ok) {
        await response.json().catch(() => {}); // ignorar si no devuelve json
        setMensaje({ tipo: "exito", texto: "✅ Asistencia registrada correctamente" });
        setID(""); // limpiar formulario
      } else {
        setMensaje({ tipo: "error", texto: "❌ Error al registrar. Código: " + response.status });
      }
    } catch (error) {
      console.error("Error:", error);
      setMensaje({ tipo: "error", texto: "⚠️ Error al registrar la asistencia" });
    }

    // Borrar el mensaje después de 3 segundos
    setTimeout(() => setMensaje(null), 3000);
  };

  return (
    <div>
      <h2>Registrar Asistencia</h2>
      
      <input
        type="text"
        placeholder="Ingrese su ID"
        value={ID}
        onChange={(e) => setID(e.target.value)}
      />
      <button onClick={enviarAsistencia}>Registrar</button>

      {mensaje && (
        <p style={{ color: mensaje.tipo === "exito" ? "green" : "red" }}>
          {mensaje.texto}
        </p>
      )}

      <Link to="/Scanner">
        <button>Escanear QR</button>
      </Link>
    </div>
  );
}

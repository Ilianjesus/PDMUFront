import { useState, useEffect } from "react";
import axios from "axios";

const Buscador = ({ placeholder = "Buscar...", onSeleccionar }) => {
  const [query, setQuery] = useState("");
  const [filtrados, setFiltrados] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelado = false; // <-- flag para cancelar la respuesta tardía

    const fetchData = async () => {
      const texto = query.trim().toLowerCase();

      if (texto.length < 2) {
        setFiltrados([]);
        return;
      }

      const url = import.meta.env.VITE_N8N_WEBHOOK_BUSCAR;
      if (!url) {
        console.warn("⚠️ Falta la variable VITE_N8N_WEBHOOK_BUSCAR en .env");
        return;
      }

      try {
        setLoading(true);
        const res = await axios.get(url);

        if (!cancelado && Array.isArray(res.data)) {
          const resultados = res.data.filter((item) => {
            const nombreCompleto = `${item.Nombre ?? ""} ${item.ApellidoPaterno ?? ""} ${item.ApellidoMaterno ?? ""}`.toLowerCase();
            return nombreCompleto.includes(texto);
          });
          setFiltrados(resultados);
        }
      } catch (error) {
        if (!cancelado) {
          console.error("❌ Error al consultar el webhook:", error.message);
          setFiltrados([]);
        }
      } finally {
        if (!cancelado) setLoading(false);
      }
    };

    fetchData();

    // 🔸 cleanup: se ejecuta si cambia query o se desmonta el componente
    return () => {
      cancelado = true;
    };
  }, [query]);

  return (
    <div style={{ width: "100%", maxWidth: "400px", margin: "0 auto" }}>
      <input
        type="text"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          width: "100%",
          padding: "10px",
          borderRadius: "6px",
          border: "1px solid #ccc",
        }}
      />

      {loading && <p style={{ marginTop: "10px" }}>Cargando resultados...</p>}

      <ul
        style={{
          listStyle: "none",
          padding: 0,
          marginTop: "10px",
          borderRadius: "6px",
          border: filtrados.length ? "1px solid #ddd" : "none",
          maxHeight: "200px",
          overflowY: "auto",
        }}
      >
        {filtrados.length > 0 ? (
          filtrados.map((item, index) => (
            <li
              key={index}
              onClick={() => onSeleccionar && onSeleccionar(item)}
              style={{
                padding: "8px",
                cursor: "pointer",
                borderBottom: "1px solid #eee",
                transition: "background 0.2s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "#f0f0f0")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              {item.Nombre} {item.ApellidoPaterno} {item.ApellidoMaterno}{" "}
              <span style={{ color: "#555" }}>({item.ID})</span>
            </li>
          ))
        ) : (
          query.length >= 2 &&
          !loading && <p>No se encontraron resultados</p>
        )}
      </ul>
    </div>
  );
};

export default Buscador;

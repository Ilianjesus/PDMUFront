import { useState, useEffect } from "react";
import axios from "axios";
import "../styles/Buscador.css";

const Buscador = ({ placeholder = "Buscar...", onSeleccionar }) => {
  const [query, setQuery] = useState("");
  const [filtrados, setFiltrados] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelado = false;

    const fetchData = async () => {
      const texto = query.trim().toLowerCase();

      if (texto.length < 2) {
        setFiltrados([]);
        return;
      }

      const url = import.meta.env.VITE_N8N_WEBHOOK_BUSCAR;
      if (!url) return;

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
        if (!cancelado) setFiltrados([]);
      } finally {
        if (!cancelado) setLoading(false);
      }
    };

    fetchData();

    return () => {
      cancelado = true;
    };
  }, [query]);

  return (
    <div className="buscador-container">

      <input
        type="text"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="buscador-input"
      />

      {loading && <p className="buscador-loading">Cargando resultados...</p>}

      {filtrados.length > 0 && (
        <ul className="buscador-lista">
          {filtrados.map((item, index) => (
            <li
              key={index}
              className="buscador-item"
              onClick={() => onSeleccionar && onSeleccionar(item)}
            >
              {item.Nombre} {item.ApellidoPaterno} {item.ApellidoMaterno}
              <span style={{ color: "#A0AEC0" }}> ({item.ID})</span>
            </li>
          ))}
        </ul>
      )}

      {query.length >= 2 && !loading && filtrados.length === 0 && (
        <p className="buscador-noresult">No se encontraron resultados</p>
      )}
    </div>
  );
};

export default Buscador;

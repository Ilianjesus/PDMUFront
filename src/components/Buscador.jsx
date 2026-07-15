import { useState, useEffect } from "react";
import { searchElements } from "../services/elementsService";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import "../styles/Buscador.css";

const Buscador = ({
  placeholder = "Buscar...",
  onSeleccionar,
}) => {
  const [query, setQuery] = useState("");
  const [filtrados, setFiltrados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);

  useEffect(() => {
    let cancelado = false;

    const fetchData = async () => {
      const searchQuery = debouncedQuery.trim();
      const texto = searchQuery.toLowerCase();

      if (texto.length < 2) {
        setFiltrados([]);
        setSearchError("");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setSearchError("");
        const result = await searchElements({
          query: searchQuery,
          limit: 20,
          cursor: null,
        });

        if (!result.ok) {
          if (!cancelado) {
            setFiltrados([]);
            setSearchError(result.message);
          }
          return;
        }

        if (!cancelado) {
          setFiltrados(result.data);
        }
      } catch (error) {
        if (!cancelado) {
          console.error("Error inesperado en la búsqueda:", error);
          setFiltrados([]);
          setSearchError("No se pudo completar la búsqueda");
        }
      } finally {
        if (!cancelado) setLoading(false);
      }
    };

    fetchData();

    return () => {
      cancelado = true;
    };
  }, [debouncedQuery]);

  return (
    <div className="buscador-container">

      <input
        type="text"
        aria-label={placeholder}
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="buscador-input"
      />

      {loading && <p className="buscador-loading">Cargando resultados...</p>}

      {searchError && (
        <p className="buscador-error" role="alert">{searchError}</p>
      )}

      {filtrados.length > 0 && (
        <ul className="buscador-lista">
          {filtrados.map((item) => (
            <li key={item.ID} className="buscador-item">
              <button
                type="button"
                className="buscador-result-button"
                onClick={() => onSeleccionar?.(item)}
              >
                <span>
                  {item.Nombre} {item.ApellidoPaterno} {item.ApellidoMaterno}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {debouncedQuery.trim().length >= 2 && !loading && !searchError && filtrados.length === 0 && (
        <p className="buscador-noresult">No se encontraron resultados</p>
      )}
    </div>
  );
};

export default Buscador;

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { searchElements } from "../services/elementsService";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import "../styles/Buscador.css";

const Buscador = ({
  placeholder = "Buscar...",
  onSeleccionar,
  resetSignal = 0,
}) => {
  const [query, setQuery] = useState("");
  const [filtrados, setFiltrados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchGeneration = useRef(0);
  const debouncedQuery = useDebouncedValue(query, 300);

  const clearSearch = useCallback(() => {
    searchGeneration.current += 1;
    setQuery("");
    setFiltrados([]);
    setSearchError("");
    setLoading(false);
  }, []);

  useEffect(() => {
    clearSearch();
  }, [clearSearch, resetSignal]);

  useEffect(() => {
    let cancelado = false;
    const generation = searchGeneration.current + 1;
    searchGeneration.current = generation;

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
            if (generation === searchGeneration.current) {
              setFiltrados([]);
              setSearchError(result.message);
            }
          }
          return;
        }

        if (!cancelado && generation === searchGeneration.current) {
          setFiltrados(result.data);
        }
      } catch (error) {
        if (!cancelado && generation === searchGeneration.current) {
          console.error("Error inesperado en la búsqueda:", error);
          setFiltrados([]);
          setSearchError("No se pudo completar la búsqueda");
        }
      } finally {
        if (!cancelado && generation === searchGeneration.current) setLoading(false);
      }
    };

    fetchData();

    return () => {
      cancelado = true;
    };
  }, [debouncedQuery]);

  const handleSelect = (item) => {
    onSeleccionar?.(item);
    clearSearch();
  };

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

      {query && (
        <button
          type="button"
          className="buscador-clear"
          onClick={clearSearch}
          aria-label="Limpiar búsqueda"
          title="Limpiar búsqueda"
        >
          <X aria-hidden="true" />
        </button>
      )}

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
                onClick={() => handleSelect(item)}
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

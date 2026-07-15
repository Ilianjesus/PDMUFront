import { useState } from "react";
import Buscador from "../components/Buscador";
import { StatusMessage } from "../components/ui/StatusMessage";
import { PageHeader } from "../components/ui/PageHeader";
import { registerPayments } from "../services/paymentsService";
import "../styles/RegistrarPago.css";

const mesesTodos = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

const RegistrarPago = () => {
  const [step, setStep] = useState(1);
  const [cliente, setCliente] = useState({ ID: "", Nombre: "" });
  const [mesesDisponibles, setMesesDisponibles] = useState([]);
  const [mesesSeleccionados, setMesesSeleccionados] = useState([]);
  const [tipoPago, setTipoPago] = useState("Efectivo");
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  const handleSeleccionCliente = (item) => {
    setMensaje(null);
    setMesesSeleccionados([]);
    setCliente({
      ID: item.ID,
      Nombre: item.Nombre,
      ApellidoPaterno: item.ApellidoPaterno,
      ApellidoMaterno: item.ApellidoMaterno
    });
  
    const fechaActual = new Date();
    const anioActual = fechaActual.getFullYear();
  
    // 🔹 Generar SOLO meses enero-diciembre del año actual
    const listaMeses = mesesTodos.map((nombreMes, index) => ({
      nombre: nombreMes,
      numero: index + 1,
      anio: anioActual
    }));
  
    setMesesDisponibles(listaMeses);
    setStep(2);
  };
  

  const toggleMesSeleccionado = (mesObj) => {
    const existe = mesesSeleccionados.some(
      (m) => m.nombre === mesObj.nombre && m.anio === mesObj.anio
    );

    const nuevosMeses = existe
      ? mesesSeleccionados.filter(
          (m) => !(m.nombre === mesObj.nombre && m.anio === mesObj.anio)
        )
      : [...mesesSeleccionados, mesObj];

    setMesesSeleccionados(nuevosMeses);
  };

  const handleFinalizar = async () => {
    if (enviando) return;
    if (
      !cliente.ID ||
      mesesSeleccionados.length === 0
    ) {
      setMensaje({
        tipo: "error",
        texto: "Selecciona un elemento y al menos un mes antes de continuar.",
      });
      return;
    }

    try {
      setEnviando(true);
      setMensaje(null);

      const result = await registerPayments({
        elementId: cliente.ID,
        year: mesesSeleccionados[0]?.anio,
        months: mesesSeleccionados.map((month) => month.numero),
        method: tipoPago,
        reference: null,
      });

      if (result.ok) {
        setMensaje({
          tipo: "success",
          texto: result.message || "Pago registrado correctamente.",
        });
  
        // Reset de formulario
        setStep(1);
        setCliente({ ID: "", Nombre: "" });
        setMesesSeleccionados([]);
        setTipoPago("Efectivo");
      } else {
        setMensaje({ tipo: "error", texto: result.message });
      }
  
    } catch (error) {
      console.error(error);
      setMensaje({
        tipo: "error",
        texto: error?.message || "Error al registrar el pago.",
      });
    } finally {
      setEnviando(false);
    }
  };
  

  return (
    <div className="pago-container page-shell">
      <div className="page-shell__inner">
        <PageHeader
          eyebrow="Pagos y mensualidades"
          title="Registrar pago"
          description="Selecciona un elemento, define el periodo cubierto y confirma el método de pago."
        />

        <div className="payment-workspace">
          <ol className="payment-progress" aria-label={`Paso ${step} de 3`}>
            {["Elemento", "Periodo", "Confirmación"].map((label, index) => (
              <li
                key={label}
                className={`${step === index + 1 ? "active" : ""}${step > index + 1 ? " complete" : ""}`}
                aria-current={step === index + 1 ? "step" : undefined}
              >
                <span>{index + 1}</span>{label}
              </li>
            ))}
          </ol>

          {mensaje && (
            <StatusMessage variant={mensaje.tipo}>{mensaje.texto}</StatusMessage>
          )}

      {/* Paso 1 */}
      {step === 1 && (
        <section className="pago-step" aria-labelledby="payment-step-one">
          <div className="payment-section-heading">
            <h2 id="payment-step-one">Seleccionar elemento</h2>
            <p>Busca por nombre o identificador para iniciar el registro.</p>
          </div>
          <Buscador
            placeholder="Buscar por nombre o ID"
            onSeleccionar={handleSeleccionCliente}
          />
        </section>
      )}

      {/* Paso 2 */}
      {step === 2 && (
        <section className="pago-step" aria-labelledby="payment-step-two">
          <div className="payment-section-heading">
            <h2 id="payment-step-two">Periodo a cubrir</h2>
            <p>
              Selecciona uno o varios meses. El importe se calculará en Supabase.
            </p>
          </div>

          <div className="pago-cliente-card">
            <span>Elemento seleccionado</span>
            <strong>{cliente.Nombre} {cliente.ApellidoPaterno ?? ""} {cliente.ApellidoMaterno ?? ""}</strong>
            <small>ID {cliente.ID}</small>
          </div>

          <div className="pago-meses-lista">
            {mesesDisponibles.map((m) => {
              const seleccionado = mesesSeleccionados.some(
                (sel) => sel.nombre === m.nombre && sel.anio === m.anio
              );
              return (
                <button
                  type="button"
                  key={`${m.nombre}-${m.anio}`}
                  onClick={() => toggleMesSeleccionado(m)}
                  className={`pago-mes-item ${seleccionado ? "seleccionado" : ""}`}
                  aria-pressed={seleccionado}
                >
                  {m.nombre} {m.anio}
                </button>
              );
            })}
          </div>

          <div className="pago-btns">
            <button type="button" className="pago-btn button-secondary" onClick={() => setStep(1)}>Volver</button>
            <button type="button" className="pago-btn" onClick={() => setStep(3)} disabled={mesesSeleccionados.length === 0}>Continuar</button>
          </div>
        </section>
      )}

      {/* Paso 3 */}
      {step === 3 && (
        <section className="pago-step" aria-labelledby="payment-step-three">
          <div className="payment-section-heading">
            <h2 id="payment-step-three">Confirmar pago</h2>
            <p>Verifica la información antes de registrar la operación.</p>
          </div>

          <div className="pago-resumen-card">
            <div><span>Elemento</span><strong>{cliente.Nombre}</strong></div>
            <div><span>Periodo</span><strong>{mesesSeleccionados.map(m => `${m.nombre} ${m.anio}`).join(", ")}</strong></div>
            <div className="payment-total">
              <span>
                Importe
              </span>
              <strong>Calculado en Supabase</strong>
            </div>
          </div>

          <div className="pago-select-wrapper">
            <label htmlFor="tipoPago">Tipo de pago:</label>
            <select
              id="tipoPago"
              className="pago-select"
              value={tipoPago}
              onChange={(e) => setTipoPago(e.target.value)}
            >
              <option value="Efectivo">Efectivo</option>
              <option value="Transferencia">Transferencia</option>
            </select>
          </div>

          <div className="pago-btns">
            <button type="button" className="pago-btn button-secondary" onClick={() => setStep(2)}>Volver</button>
            <button type="button" className="pago-btn" onClick={handleFinalizar} disabled={enviando}>
              {enviando ? "Enviando..." : "Finalizar"}
            </button>
          </div>
        </section>
      )}
        </div>
      </div>
    </div>
  );
};

export default RegistrarPago;

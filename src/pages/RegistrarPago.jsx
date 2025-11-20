import React, { useState } from "react";
import axios from "axios";
import Buscador from "../components/Buscador";
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
  const [cantidad, setCantidad] = useState(0);
  const [tipoPago, setTipoPago] = useState("Efectivo");
  const [enviando, setEnviando] = useState(false);

  const handleSeleccionCliente = (item) => {
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
    setCantidad(nuevosMeses.length * 200);
  };

  const handleFinalizar = async () => {
    const url = import.meta.env.VITE_N8N_WEBHOOK_PAGAR;
    if (!url) {
      alert("⚠️ Falta la variable VITE_N8N_WEBHOOK_PAGOS en .env");
      return;
    }
  
    const payload = {
      ID: cliente.ID,
      Nombre: `${cliente.Nombre} ${cliente.ApellidoPaterno ?? ""} ${cliente.ApellidoMaterno ?? ""}`.trim(),
      MesesPagados: mesesSeleccionados.map((m) => `${m.nombre} ${m.anio}`).join(", "),
      Cantidad: cantidad,
      TipoPago: tipoPago,
    };
  
    try {
      setEnviando(true);
  
      // ⬇️ Esperamos respuesta del webhook
      const respuesta = await axios.post(url, payload);
      const data = respuesta.data;
  
      // ⬇️ Validamos la respuesta JSON del webhook respond
      if (data?.status === "exito") {
        alert("Pago registrado correctamente 🎉");
  
        // Reset de formulario
        setStep(1);
        setCliente({ ID: "", Nombre: "" });
        setMesesSeleccionados([]);
        setCantidad(0);
        setTipoPago("Efectivo");
      } else {
        alert("❌ El pago no pudo completarse");
      }
  
    } catch (error) {
      console.error(error);
      alert("❌ Error al registrar pago");
    } finally {
      setEnviando(false);
    }
  };
  

  return (
    <div className="pago-container">

      {/* Paso 1 */}
      {step === 1 && (
        <div className="pago-step">
          <h2 className="pago-title">Buscar Elemento</h2>
          <Buscador
            placeholder="Buscar cliente..."
            onSeleccionar={handleSeleccionCliente}
          />
        </div>
      )}

      {/* Paso 2 */}
      {step === 2 && (
        <div className="pago-step">
          <h2 className="pago-title">Seleccionar Meses</h2>

          <div className="pago-cliente-card">
            <p><strong>ID:</strong> {cliente.ID}</p>
            <p><strong>Nombre:</strong> {cliente.Nombre} {cliente.ApellidoPaterno ?? ""} {cliente.ApellidoMaterno ?? ""}</p>
          </div>

          <div className="pago-meses-lista">
            {mesesDisponibles.map((m, i) => {
              const seleccionado = mesesSeleccionados.some(
                (sel) => sel.nombre === m.nombre && sel.anio === m.anio
              );
              return (
                <div
                  key={i}
                  onClick={() => toggleMesSeleccionado(m)}
                  className={`pago-mes-item ${seleccionado ? "seleccionado" : ""}`}
                >
                  {m.nombre} {m.anio}
                </div>
              );
            })}
          </div>

          <div className="pago-btns">
            <button className="pago-btn" onClick={() => setStep(1)}>Atrás</button>
            <button className="pago-btn" onClick={() => setStep(3)} disabled={mesesSeleccionados.length === 0}>Continuar</button>
          </div>
        </div>
      )}

      {/* Paso 3 */}
      {step === 3 && (
        <div className="pago-step">
          <h2 className="pago-title">Finalizar Pago</h2>

          <div className="pago-resumen-card">
            <p><strong>Cliente:</strong> {cliente.Nombre}</p>
            <p><strong>Meses:</strong> {mesesSeleccionados.map(m => `${m.nombre} ${m.anio}`).join(", ")}</p>
            <p><strong>Total:</strong> ${cantidad}</p>
          </div>

          <div className="pago-select-wrapper">
            <label>Tipo de pago:</label>
            <select
              className="pago-select"
              value={tipoPago}
              onChange={(e) => setTipoPago(e.target.value)}
            >
              <option value="Efectivo">Efectivo</option>
              <option value="Transferencia">Transferencia</option>
            </select>
          </div>

          <div className="pago-btns">
            <button className="pago-btn" onClick={() => setStep(2)}>Atrás</button>
            <button className="pago-btn" onClick={handleFinalizar} disabled={enviando}>
              {enviando ? "Enviando..." : "Finalizar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RegistrarPago;

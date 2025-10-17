import React, { useState } from "react";
import axios from "axios";
import Buscador from "../components/Buscador";

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
    const mesActual = fechaActual.getMonth();
    const anioActual = fechaActual.getFullYear();
    const listaMeses = [];

    for (let i = -12; i <= 12; i++) {
      const nuevaFecha = new Date(anioActual, mesActual + i, 1);
      const nombreMes = mesesTodos[nuevaFecha.getMonth()];
      const anio = nuevaFecha.getFullYear();
      listaMeses.push({ nombre: nombreMes, anio });
    }

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
      await axios.post(url, payload);
      alert("Pago registrado ✅");
      setStep(1);
      setCliente({ ID: "", Nombre: "" });
      setMesesSeleccionados([]);
      setCantidad(0);
      setTipoPago("Efectivo");
    } catch (error) {
      console.error(error);
      alert("❌ Error al registrar pago");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div>
      {/* PASO 1: BUSCAR CLIENTE */}
      {step === 1 && (
        <>
          <h2>Buscar Elemento</h2>
          <Buscador placeholder="Buscar cliente..." onSeleccionar={handleSeleccionCliente} />
        </>
      )}

      {/* PASO 2: SELECCIONAR MESES */}
      {step === 2 && (
        <>
          <h2>Seleccionar Meses a Pagar</h2>
          <div>
            <p><strong>ID:</strong> {cliente.ID}</p>
            <p><strong>Nombre:</strong> {cliente.Nombre} {cliente.ApellidoPaterno ?? ""} {cliente.ApellidoMaterno ?? ""}</p>
          </div>

          <div style={{ border: "1px solid #ccc", maxHeight: "200px", overflowY: "auto" }}>
            {mesesDisponibles.map((m, i) => {
              const seleccionado = mesesSeleccionados.some(
                (sel) => sel.nombre === m.nombre && sel.anio === m.anio
              );
              return (
                <div
                  key={i}
                  onClick={() => toggleMesSeleccionado(m)}
                  style={{
                    padding: "4px",
                    cursor: "pointer",
                    background: seleccionado ? "#ddd" : "#fff",
                  }}
                >
                  {m.nombre} {m.anio}
                </div>
              );
            })}
          </div>

          <div>
            <button onClick={() => setStep(1)}>Atrás</button>
            <button onClick={() => setStep(3)} disabled={mesesSeleccionados.length === 0}>Continuar</button>
          </div>
        </>
      )}

      {/* PASO 3: FINALIZAR */}
      {step === 3 && (
        <>
          <h2>Finalizar Pago</h2>
          <div>
            <p><strong>Cliente:</strong> {cliente.Nombre}</p>
            <p><strong>Meses:</strong> {mesesSeleccionados.map(m => `${m.nombre} ${m.anio}`).join(", ")}</p>
            <p><strong>Cantidad total:</strong> ${cantidad}</p>
          </div>

          <div>
            <label>Tipo de pago:</label>
            <select value={tipoPago} onChange={(e) => setTipoPago(e.target.value)}>
              <option value="Efectivo">Efectivo</option>
              <option value="Transferencia">Transferencia</option>
            </select>
          </div>

          <div>
            <button onClick={() => setStep(2)}>Atrás</button>
            <button onClick={handleFinalizar} disabled={enviando}>
              {enviando ? "Enviando..." : "Finalizar"}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default RegistrarPago;

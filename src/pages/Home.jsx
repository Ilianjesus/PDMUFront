import { useEffect, useState } from "react";
import { puntos } from "../data/Puntos";
import { useNavigate } from "react-router-dom";

export function Home() {
    const navigate = useNavigate();
    const [puntoAleatorio, setPuntoAleatorio] = useState("");

    useEffect(() => {
        const index = Math.floor(Math.random() * puntos.length);
        setPuntoAleatorio(puntos[index]);
    }, []);

    const irARegistrarPago = () => {
        navigate("/RegistrarPago");
    };

    return (
        <div className="home-container">
            <h2>Home</h2>
            <p>Bienvenido</p>
            <blockquote style={{ marginTop: "20px", fontStyle: "italic" }}>
                {puntoAleatorio}
            </blockquote>

            <p style={{ marginTop: "20px", fontWeight: "bold", color: "white", fontSize: "48px" }}>
                PAGINA EN DESARROLLO
            </p>

            <button onClick={irARegistrarPago}>
                Registrar pago
            </button>
            
        </div>
    );
}

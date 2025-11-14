import { useEffect, useState } from "react";
import { puntos } from "../data/Puntos";
import { useNavigate } from "react-router-dom";
import "../styles/Home.css";

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
            <h2 className="home-title">Home</h2>
            <p className="home-welcome">Bienvenido</p>

            <div className="punto-box">
                <blockquote>{puntoAleatorio}</blockquote>
            </div>

            <p className="dev-text">PÁGINA EN DESARROLLO</p>

            {/* FAB Registrar Pago */}
            <button className="fab fab-primary" onClick={irARegistrarPago}>
                +
            </button>

            {/* FAB Admin */}
            <button
                className="fab fab-secondary"
                onClick={() => navigate("/PanelAdmin")}
            >
                ⚙
            </button>
        </div>
    );
}

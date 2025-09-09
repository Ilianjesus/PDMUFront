import { useEffect, useState } from "react";
import { puntos } from "../data/Puntos"; // Ajusta el path según tu estructura

export function Home() {
    const [puntoAleatorio, setPuntoAleatorio] = useState("");

    useEffect(() => {
        const index = Math.floor(Math.random() * puntos.length);
        setPuntoAleatorio(puntos[index]);
    }, []);

    return (
        <div className="home-container">
            <h2>Home</h2>
            <p>Bienvenido</p>
            <blockquote style={{ marginTop: "20px", fontStyle: "italic" }}>
                {puntoAleatorio}
            </blockquote>
            
        </div>
    );
}

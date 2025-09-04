
import { Link } from "react-router-dom";

export function Home() {
    return (
    <div>
        <h2>Home</h2>
        <Link to= "/registrar-asistencia">
        <button className="button" >Registrar Asistencia</button>
        </Link>
        <Link to= "/RegistrarElemento">
        <button className="button" >Registrar Elemento</button>
        </Link>
        <Link to= "/Estadisticas">
        <button className="button" >Estadísticas</button>
        </Link>
    </div>

    
    );
}


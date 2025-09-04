
import { Link } from "react-router-dom";

export function Home() {
    return (
    <div>
        <h2>Home</h2>
        <Link to= "/registrar-asistencia">
        <button className="button" >Registrar Asistencia</button>
        </Link>
    </div>

    
    );
}


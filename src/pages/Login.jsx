import { Link } from "react-router-dom";

export function Login() {
    return (
    <div>
        <h2>Este es el login</h2>
        <Link to="/home">
        <button>Iniciar Sesion</button>
        </Link>
    </div>
    );
}

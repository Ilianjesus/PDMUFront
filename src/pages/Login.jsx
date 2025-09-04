import { Link } from "react-router-dom";
import "../styles/global.css"; // importa tu CSS global
import logo from "../assets/logo.jpeg"; // Asegúrate de tener un logo en esta ruta

export function Login() {
  return (
    <div className="login-container">
      <img src={logo} alt="logo" className="login-logo" />
      <h1 className="login-title">Bienvenido</h1>
      <input type="text" placeholder="Usuario" className="login-input" />
      <input type="password" placeholder="Contraseña" className="login-input" />
      <Link to="/home" style={{ width: "100%", textAlign: "center" }}>
        <button className="button">Iniciar Sesión</button>
      </Link>
    </div>
  );
}

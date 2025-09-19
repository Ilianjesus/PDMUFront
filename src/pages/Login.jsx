// src/pages/Login.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import "../styles/global.css";
import logo from "../assets/logo.jpeg";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setError("");
      await login(email, password);
      navigate("/home");
    } catch (err) {
      setError("Credenciales inválidas");
      console.error(err);
    }
  };

  return (
    <div className="login-container">
      <img src={logo} alt="logo" className="login-logo" />
      <h1 className="login-title">Bienvenido</h1>

      {error && <p className="error">{error}</p>}

      <form onSubmit={handleSubmit} className="login-form">
        <input
          type="email"
          placeholder="Correo electrónico"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="login-input"
          required
        />
        <input
          type="password"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="login-input"
          required
        />
        <button type="submit" className="button">
          Iniciar Sesión
        </button>
      </form>
    </div>
  );
}

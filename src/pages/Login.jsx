// src/pages/Login.jsx
import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { AuthLoading } from "../components/AuthLoading";
import { StatusMessage } from "../components/ui/StatusMessage";
import { Info } from "lucide-react";
import "../styles/global.css";
import logo from "../assets/logo.jpeg";

const normalizeNumericOtp = (value) =>
  value.replace(/[\s-]/g, "").replace(/\D/g, "").slice(0, 8);

export function Login() {
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [resendMessage, setResendMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const { authStatus, session, requestOtp, verifyOtp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const requestedLocation = location.state?.from;
  const destination = requestedLocation?.pathname
    ? `${requestedLocation.pathname}${requestedLocation.search ?? ""}`
    : "/home";

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;

    const timer = setTimeout(() => {
      setResendCooldown((current) => Math.max(0, current - 1));
    }, 1000);

    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleEmailContinue = async (e) => {
    e.preventDefault();

    try {
      setSubmitting(true);
      setError("");
      setResendMessage("");
      const result = await requestOtp(email);
      setEmail(result.email);
      setStep("otp");
      setResendCooldown(60);
    } catch (err) {
      setError("No se pudo solicitar el código. Intenta nuevamente.");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();

    const normalizedOtp = normalizeNumericOtp(otp);
    setOtp(normalizedOtp);

    if (normalizedOtp.length < 6 || normalizedOtp.length > 8) {
      setError("El código debe tener entre 6 y 8 dígitos.");
      return;
    }

    try {
      setSubmitting(true);
      setError("");
      await verifyOtp(email, normalizedOtp);
      navigate(destination, { replace: true });
    } catch (err) {
      setError("El código es inválido o expiró. Solicita uno nuevo.");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    try {
      setSubmitting(true);
      setError("");
      await requestOtp(email);
      setResendMessage("Se solicitó un nuevo código.");
      setResendCooldown(60);
    } catch (err) {
      setError("No se pudo reenviar el código. Intenta nuevamente.");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleChangeEmail = () => {
    setStep("email");
    setOtp("");
    setError("");
    setResendMessage("");
    setResendCooldown(0);
  };

  if (authStatus === "loading") {
    return <AuthLoading />;
  }

  if (authStatus === "authenticated" && session) {
    return <Navigate to={destination} replace />;
  }

  return (
    <div className="login-container">
      <main className="login-card">
        <div className="login-brand">
          <img src={logo} alt="Escudo de PDMU" className="login-logo" />
          <div>
            <h1 className="login-title">PDMU Digital</h1>
            <p>Acceso</p>
          </div>
        </div>

        <div className="login-divider" />

        {error && <StatusMessage variant="error">{error}</StatusMessage>}
        {resendMessage && step === "otp" && (
          <StatusMessage variant="info">{resendMessage}</StatusMessage>
        )}

        {step === "email" ? (
          <form onSubmit={handleEmailContinue} className="login-form">
            <div className="login-form__header login-form__header--inline">
              <h2>Ingresar correo</h2>
              <span
                className="info-tooltip"
                tabIndex={0}
                aria-label="Usa el correo autorizado para operar PDMU Digital."
              >
                <Info aria-hidden="true" />
                <span className="info-tooltip__content" role="tooltip">
                  Usa el correo autorizado para operar PDMU Digital.
                </span>
              </span>
            </div>
            <label className="visually-hidden" htmlFor="login-email">
              Correo electrónico
            </label>
            <input
              id="login-email"
              type="email"
              placeholder="Correo electrónico"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="login-input"
              autoComplete="email"
              disabled={submitting}
              required
            />
            <button type="submit" className="button" disabled={submitting}>
              {submitting ? "Enviando..." : "Enviar código"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="login-form">
            <div className="login-form__header">
              <h2>Verificación por código</h2>
              <strong className="login-email-target">{email}</strong>
            </div>
            <label className="visually-hidden" htmlFor="login-otp">
              Código de acceso
            </label>
            <input
              id="login-otp"
              type="text"
              inputMode="numeric"
              placeholder="Código OTP"
              value={otp}
              onChange={(e) => setOtp(normalizeNumericOtp(e.target.value))}
              className="login-input login-otp-input"
              autoComplete="one-time-code"
              disabled={submitting}
              required
              autoFocus
            />
            <button
              type="submit"
              className="button"
              disabled={submitting}
            >
              {submitting ? "Verificando..." : "Verificar código"}
            </button>
            <div className="login-secondary-actions">
              <button
                type="button"
                className="login-text-button"
                onClick={handleResend}
                disabled={submitting || resendCooldown > 0}
              >
                {resendCooldown > 0
                  ? `Reenviar en ${resendCooldown}s`
                  : "Reenviar código"}
              </button>
              <button
                type="button"
                className="login-text-button"
                onClick={handleChangeEmail}
                disabled={submitting}
              >
                Cambiar correo
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}

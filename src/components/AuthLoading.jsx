import { LoadingState } from "./ui/LoadingState";

export function AuthLoading() {
  return (
    <div className="auth-loading">
      <LoadingState compact label="Verificando sesión..." />
    </div>
  );
}

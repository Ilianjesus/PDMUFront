import { lazy, Suspense } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { Login } from "./pages/Login";
import { Layout } from "./components/Layout";
import { AuthProvider } from "./contexts/AuthContext";
import { RequireAuth } from "./components/RequireAuth";
import { AuthenticatedShell } from "./components/AuthenticatedShell";
import { LoadingState } from "./components/ui/LoadingState";
import { RequireAdmin } from "./components/RequireAdmin";

const Home = lazy(() =>
  import("./pages/Home").then((module) => ({ default: module.Home }))
);
const RegistrarAsistencia = lazy(() =>
  import("./pages/RegistrarAsistencia").then((module) => ({
    default: module.RegistrarAsistencia,
  }))
);
const Scanner = lazy(() =>
  import("./components/Scanner").then((module) => ({ default: module.Scanner }))
);
const RegistrarElemento = lazy(() =>
  import("./pages/RegistrarElemento").then((module) => ({
    default: module.RegistrarElemento,
  }))
);
const Estadisticas = lazy(() =>
  import("./pages/Estadisticas").then((module) => ({
    default: module.Estadisticas,
  }))
);
const PanelAdmin = lazy(() => import("./components/PanelAdmin"));
const Operadores = lazy(() =>
  import("./pages/Operadores").then((module) => ({ default: module.Operadores }))
);
const Pagos = lazy(() =>
  import("./pages/Pagos").then((module) => ({ default: module.Pagos }))
);
const Mas = lazy(() =>
  import("./pages/Mas").then((module) => ({ default: module.Mas }))
);

function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Suspense fallback={<LoadingState label="Cargando módulo..." />}>
          <Routes>
            <Route path="/" element={<Navigate to="/inicio" replace />} />
            <Route path="/login" element={<Login />} />

            <Route element={<RequireAuth />}>
              <Route element={<AuthenticatedShell />}>
                <Route element={<Layout />}>
                  <Route path="/inicio" element={<Home />} />
                  <Route path="/home" element={<Navigate to="/inicio" replace />} />
                  <Route path="/asistencia" element={<RegistrarAsistencia />} />
                  <Route path="/asistencias" element={<Navigate to="/asistencia" replace />} />
                  <Route path="/asistencia/escaner" element={<Scanner />} />
                  <Route path="/scanner" element={<Navigate to="/asistencia/escaner" replace />} />
                  <Route path="/elementos" element={<PanelAdmin />} />
                  <Route path="/elementos/nuevo" element={<RegistrarElemento />} />
                  <Route path="/elementos/:elementId" element={<PanelAdmin />} />
                  <Route path="/elementos/:elementId/:section" element={<PanelAdmin />} />
                  <Route path="/inscripciones" element={<Navigate to="/elementos/nuevo" replace />} />
                  <Route path="/pagos" element={<Pagos />} />
                  <Route path="/reportes" element={<Estadisticas />} />
                  <Route path="/estadisticas" element={<Navigate to="/reportes" replace />} />
                  <Route path="/mas" element={<Mas />} />
                  <Route element={<RequireAdmin />}>
                    <Route path="/administracion/operadores" element={<Operadores />} />
                    <Route path="/operadores" element={<Navigate to="/administracion/operadores" replace />} />
                  </Route>
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/inicio" replace />} />
          </Routes>
        </Suspense>
      </HashRouter>
    </AuthProvider>
  );
}

export default App;

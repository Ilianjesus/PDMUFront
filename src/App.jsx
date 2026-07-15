import { lazy, Suspense } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { Login } from "./pages/Login";
import { Layout } from "./components/Layout";
import { AuthProvider } from "./contexts/AuthContext";
import { RequireAuth } from "./components/RequireAuth";
import { AuthenticatedShell } from "./components/AuthenticatedShell";
import { LoadingState } from "./components/ui/LoadingState";

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
const RegistrarPago = lazy(() => import("./pages/RegistrarPago"));
const PanelAdmin = lazy(() => import("./components/PanelAdmin"));

function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Suspense fallback={<LoadingState label="Cargando módulo..." />}>
          <Routes>
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route path="/login" element={<Login />} />

            <Route element={<RequireAuth />}>
              <Route element={<AuthenticatedShell />}>
                <Route element={<Layout />}>
                  <Route path="/home" element={<Home />} />
                  <Route
                    path="/registrar-asistencia"
                    element={<RegistrarAsistencia />}
                  />
                  <Route
                    path="/RegistrarElemento"
                    element={<RegistrarElemento />}
                  />
                  <Route path="/Estadisticas" element={<Estadisticas />} />
                  <Route path="/Scanner" element={<Scanner />} />
                  <Route path="/RegistrarPago" element={<RegistrarPago />} />
                  <Route path="/PanelAdmin" element={<PanelAdmin />} />

                  <Route
                    path="/ModuloInfo"
                    element={<Navigate to="/PanelAdmin" replace />}
                  />
                  <Route
                    path="/ModuloPagos"
                    element={<Navigate to="/PanelAdmin" replace />}
                  />
                  <Route
                    path="/ModuloAsistencias"
                    element={<Navigate to="/PanelAdmin" replace />}
                  />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Routes>
        </Suspense>
      </HashRouter>
    </AuthProvider>
  );
}

export default App;

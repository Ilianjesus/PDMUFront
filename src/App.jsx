// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Home } from "./pages/Home";
import { Login } from "./pages/Login";
import { RegistrarAsistencia } from "./pages/RegistrarAsistencia";
import { Scanner } from "./components/Scanner";
import { RegistrarElemento } from "./pages/RegistrarElemento";
import { Estadisticas } from "./pages/Estadisticas";
import { Layout } from "./components/Layout";
import { RegistrarPago } from "./pages/RegistrarPago";
import { AuthProvider } from "./contexts/AuthContext";
import { RequireAuth } from "./components/RequireAuth";

function App() {
    return (
      <AuthProvider>
        <BrowserRouter basename="/PDMUFront">
          <Routes>
            <Route path="/" element={<Navigate to="/login" />} />
            <Route path="/login" element={<Login />} />
  
            <Route element={<Layout />}>
              <Route
                path="/home"
                element={
                  <RequireAuth>
                    <Home />
                  </RequireAuth>
                }
              />
              <Route
                path="/registrar-asistencia"
                element={
                  <RequireAuth>
                    <RegistrarAsistencia />
                  </RequireAuth>
                }
              />
              <Route
                path="/RegistrarElemento"
                element={
                  <RequireAuth>
                    <RegistrarElemento />
                  </RequireAuth>
                }
              />
              <Route
                path="/Estadisticas"
                element={
                  <RequireAuth>
                    <Estadisticas />
                  </RequireAuth>
                }
              />
            </Route>
  
            <Route path="/Scanner" element={<Scanner />} />
            <Route path="/RegistrarPago" element={<RegistrarPago />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    );
  }
  
  export default App;
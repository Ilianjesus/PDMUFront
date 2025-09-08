import { BrowserRouter, Routes, Route, Navigate, HashRouter } from 'react-router-dom';
import {Home} from './pages/Home';
import {Login} from './pages/Login';
import {RegistrarAsistencia} from './pages/RegistrarAsistencia';
import {Scanner} from './components/Scanner';
import {RegistrarElemento} from './pages/RegistrarElemento';
import { Estadisticas } from './pages/Estadisticas';
import { Layout } from './components/Layout';
import { RegistrarPago } from './pages/RegistrarPago';


function App () {
    return ( 
    <HashRouter>
        <Routes>
            <Route path='/' element={<Navigate to ="/login"/>}/>
            <Route path='/login' element={<Login/>}/>

            <Route element={<Layout/>}>
                <Route path='/home' element={<Home/>}/>
                <Route path='/registrar-asistencia' element={<RegistrarAsistencia/>}/>
                <Route path='/RegistrarElemento' element={<RegistrarElemento/>}/>
                <Route path='/Estadisticas' element={<Estadisticas/>}/>
            </Route>

            <Route path='/Scanner' element={<Scanner/>}/>
            <Route path='/RegistrarPago' element={<RegistrarPago/>}/>
        </Routes>
    </HashRouter>
      );
    }
    
export default App;
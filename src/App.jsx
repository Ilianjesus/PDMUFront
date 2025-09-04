import { BrowserRouter, Routes, Route, Navigate, HashRouter } from 'react-router-dom';
import {Home} from './pages/Home';
import {Login} from './pages/Login';
import {RegistrarAsistencia} from './pages/RegistrarAsistencia';
import {Scanner} from './components/Scanner';
import {RegistrarElemento} from './pages/RegistrarElemento';
import { Estadisticas } from './pages/Estadisticas';


function App () {
    return ( 
    <HashRouter>
        <Routes>
            <Route path='/' element={<Navigate to ="/login"/>}/>
            <Route path='/home' element={<Home/>}/>
            <Route path='/login' element={<Login/>}/>
            <Route path='/registrar-asistencia' element={<RegistrarAsistencia/>}/>
            <Route path='/Scanner' element={<Scanner/>}/>
            <Route path='/RegistrarElemento' element={<RegistrarElemento/>}/>
            <Route path='/Estadisticas' element={<Estadisticas/>}/>
        </Routes>
    </HashRouter>
      );
    }
    
export default App;
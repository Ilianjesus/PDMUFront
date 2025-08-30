import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import {Home} from './pages/Home';
import {Login} from './pages/Login';
import {RegistrarAsistencia} from './pages/RegistrarAsistencia';
import {Scanner} from './components/Scanner';


function App () {
    return ( 
    <BrowserRouter>
        <Routes>
            <Route path='/' element={<Navigate to ="/login"/>}/>
            <Route path='/home' element={<Home/>}/>
            <Route path='/login' element={<Login/>}/>
            <Route path='/registrar-asistencia' element={<RegistrarAsistencia/>}/>
            <Route path='/Scanner' element={<Scanner/>}/>
        </Routes>
    </BrowserRouter>
      );
    }
    
export default App;
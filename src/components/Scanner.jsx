import { Html5QrcodeScanner } from "html5-qrcode";
import { useEffect, useState } from "react";

export function Scanner() {
    const [scanResult, setScanResult] = useState(null); 

    useEffect(() => {
        const scanner = new Html5QrcodeScanner( "reader", {
            qrbox:{
               width: 250,
               height: 250
            },
            fps: 5,
       })

       scanner.render(success, error);
       
       async function success(result){
           scanner.clear();
           setScanResult(result);

        //Guardamos el resultado y lo enviamos al webhook con POST
        try {
            const response = await fetch('https://n8n.scolaris.com.mx/webhook-test/5e5fb667-eb3a-457c-ae33-0b1459584727', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ id: result }),
            }
        );
            if (!response.ok){
                throw new Error("Error en la soolicitud "+ response.statusText);;
            }
            console.log("Datos enviados correctamente");
            } catch (err) {
            console.error("Error al enviar los datos: ", err);
            }
        }
   
       function error(err) {
           console.warn(err);
       }
    }, []); 

    

    return (
        <div>
            <h1>Escaner de QR</h1>
            { scanResult 
            ? <div>Succes: <a href={"http://"+scanResult}>{scanResult}</a>  </div>
            : <div id="reader"></div> 
            }
        </div>
    );
    
}

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
            const response = await fetch('https://eurusdeveloper.app.n8n.cloud/webhook-test/265eb356-cb2b-48e9-b49b-59540a7fd28f', {
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

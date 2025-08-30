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
       
       function success(result){
           scanner.clear();
           setScanResult(result);
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
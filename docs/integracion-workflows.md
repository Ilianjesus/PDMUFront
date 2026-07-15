# Integración con workflows externos

Fecha: 28 de junio de 2026  
Alcance: refactorización P1 del frontend. Los workflows externos y sus contratos de entrada no fueron modificados.

## Principios de la capa

1. Los componentes no conocen URLs, `fetch`, Axios ni detalles de transporte.
2. `src/config/env.js` es el único lugar que lee variables `VITE_*` de workflows.
3. `src/services/httpClient.js` es el único lugar que ejecuta peticiones HTTP.
4. Los adaptadores de `src/services/workflows/` conservan los payloads externos actuales y normalizan el resultado para React.
5. Una respuesta de workflow no se considera igual a una respuesta HTTP: primero se valida transporte y después status/formato de negocio.

## Advertencia sobre variables Vite

Las variables con prefijo `VITE_*` se incorporan al JavaScript generado y **son públicas para cualquier persona que cargue la aplicación**. No son secretos, no autentican al usuario y no deben utilizarse como único mecanismo para proteger un webhook.

La capa valida cada URL cuando se usa. En desarrollo también informa en consola todas las variables ausentes o inválidas al iniciar la app. Un error de configuración se devuelve a la UI como `CONFIG_ERROR`, sin que cada componente tenga que inspeccionar `.env`.

## Variables soportadas

| Clave interna | Variable actual | Alias compatible | Uso |
|---|---|---|---|
| `searchElements` | `VITE_N8N_WEBHOOK_BUSCAR` | — | Descargar elementos para búsqueda. |
| `registerPayment` | `VITE_N8N_WEBHOOK_PAGAR` | `VITE_N8N_WEBHOOK_PAGOS` | Registrar mensualidades. `PAGAR` sigue siendo el nombre canónico actual. |
| `admin` | `VITE_N8N_WEBHOOK_ADMIN` | — | Lectura, actualización y eliminación administrativa. |
| `registerElement` | `VITE_N8N_WEBHOOK_INSCRIPCION` | — | Inscripción multipart. |
| `attendance` | `VITE_N8N_WEBHOOK_ASISTENCIA` | — | Registro manual y QR. |
| `uploadDocuments` | `VITE_N8N_WEBHOOK_UPLOAD_DOCS` | — | Actualización de campos y documentos. |
| `dashboard` | `VITE_N8N_WEBHOOK_ESTATISTICS` | `VITE_N8N_WEBHOOK_STATISTICS` | Resumen de Home. Se conserva el typo histórico `ESTATISTICS`. |

Los alias son solo de configuración frontend. No cambian ninguna URL ni request y permiten una migración posterior de nombres sin romper los entornos actuales.

## Cliente HTTP

`src/services/httpClient.js` ofrece:

- `get(url, options)`.
- `postJson(url, payload, options)`.
- `postFormData(url, formData, options)`.
- Timeout general de 30 segundos y 60 segundos para cargas de documentos.
- Parseo de JSON incluso si el servidor omite el content type.
- Soporte seguro para respuestas vacías o texto plano.
- Rechazo explícito de JSON inválido cuando el servidor declara JSON.
- Errores normalizados para red, timeout y HTTP.

| Código interno | Significado |
|---|---|
| `CONFIG_ERROR` | Variable ausente o URL inválida. |
| `NETWORK_ERROR` | No se pudo establecer conexión. |
| `TIMEOUT` | Se agotó el tiempo de espera. |
| `HTTP_ERROR` | Respuesta HTTP no exitosa, normalmente 4xx. |
| `SERVER_ERROR` | Respuesta HTTP 5xx. |
| `INVALID_RESPONSE` | JSON o forma de datos inesperada. |
| `BUSINESS_ERROR` | El workflow respondió sin un status aceptado. |
| `ALREADY_EXISTS` | Estado externo `already exists`, usado por inscripción. |

### Punto futuro de credenciales

El cliente contiene `setAccessTokenProvider()` y la opción `includeAccessToken`. Ningún servicio actual activa esa opción y el provider no se configura, por lo que **no se añadió ningún header ni token a n8n en esta fase**.

Cuando se acuerde autorización real, podrá conectarse `AuthContext.getAccessToken()` —o la sesión OTP futura— en un único lugar y habilitarse por endpoint. Antes de hacerlo se debe confirmar que los workflows aceptan y validan la credencial.

## Resultado normalizado para la aplicación

Todos los servicios resuelven con uno de estos formatos; los errores esperables de configuración/red/workflow no obligan al componente a conocer excepciones de `fetch` o Axios.

```js
{
  ok: true,
  data,
  message,
  raw
}
```

```js
{
  ok: false,
  code,
  message,
  raw
}
```

`raw` se conserva para diagnóstico interno, pero la UI debe usar `ok`, `code`, `message` y `data`.

El normalizador entiende:

- `status: "success"`.
- `status: "exito"`.
- Mayúsculas, espacios alrededor y estados de error.
- Respuestas n8n como `{ json: ... }` o arrays envueltos cuando el servicio correspondiente lo espera.
- HTTP 2xx sin status de negocio únicamente en integraciones donde ese era el contrato previo, como registro de asistencia.
- Respuestas de búsqueda como arrays sin status.

Un status externo desconocido no se transforma en éxito solo porque HTTP haya sido 2xx.

## Servicios y contratos externos preservados

### `elementsWorkflow.js`

#### Búsqueda

- Método: GET.
- Payload: ninguno.
- Respuesta externa esperada: array de elementos.
- El filtrado por nombre sigue ocurriendo en `Buscador`; esta fase no altera el workflow.

#### Inscripción

- Método: POST `FormData`.
- Campos personales conservados: `nombre`, `apellidoPaterno`, `apellidoMaterno`, `grupo`, `fechaNacimiento`, `sexo`, `tutor`, `telefonoTutor`, `enfermedades`.
- Archivos conservados: `ineTutor`, `certificadoMedico`, `comprobanteDomicilio`, `actaNacimiento`, `curp`, `hojaInscripcion`.
- Status aceptado: `success`; `already exists` se normaliza a `ALREADY_EXISTS`.

#### Actualización de campo

```js
{ ID, field, value }
```

#### Carga de documento

`FormData` con `file`, `documentType` e `ID`. La respuesta debe aportar `url` y puede incluir `status: "success"`.

### `paymentsWorkflow.js`

#### Registro

El componente sigue construyendo el mismo payload de negocio y el servicio lo transmite sin renombrar:

```js
{
  ID,
  Nombre,
  MesesPagados,
  Cantidad,
  TipoPago
}
```

Se aceptan `exito` —contrato histórico— y `success` como respuestas exitosas.

#### Actualización administrativa

```js
{
  sheet: "Pagos",
  operacion: "update",
  ID,
  datos: {
    row_number,
    "ID Pago",
    Mes,
    Año,
    Cantidad,
    "Tipo de Pago"
  }
}
```

#### Eliminación administrativa

```js
{
  sheet: "Pagos",
  operacion: "delete",
  ID,
  datos: { row_number, "ID Pago" }
}
```

### `attendanceWorkflow.js`

Registro manual y QR comparten ahora la misma función y mantienen:

```js
{ ID }
```

Actualizar conserva:

```js
{
  sheet: "Asistencias",
  operacion: "update",
  ID,
  datos: { row_number, Estado, Tipo, FechaHora }
}
```

Eliminar conserva:

```js
{
  sheet: "Asistencias",
  operacion: "delete",
  ID,
  datos: { row_number }
}
```

### `adminWorkflow.js`

Lectura de módulo:

```js
{ sheet, operacion: "leer", ID }
```

El mapeo de UI se conserva: `Informacion → elementos`, `Pagos → Pagos`, `Asistencias → Asistencias`.

Eliminar elemento conserva:

```js
{ sheet: "elementos", operacion: "delete", ID }
```

También existe `executeAdminOperation` para el flujo genérico ya presente en `PanelAdmin`.

### `dashboardWorkflow.js`

- Método: GET.
- Status requerido: `success`.
- La UI recibe directamente el contenido de `data` y conserva los campos `resumenRapido`, `alertasImportantes` y `actividadReciente`.

## Componentes migrados

- `Buscador` → `searchElements`.
- `RegistrarElemento` → `registerElement`.
- `RegistrarPago` → `registerPayment`.
- `RegistrarAsistencia` y `Scanner` → `registerAttendance`.
- `PanelAdmin` → `readAdminModule`, `executeAdminOperation`, `deleteElement`.
- `ModuloInfo` → `updateElementField`, `uploadElementDocument`.
- `ModuloPagos` → `updatePayment`, `deletePayment`.
- `ModuloAsistencias` → `updateAttendance`, `deleteAttendance`.
- `Home` → `getDashboardSummary`.

## Mejoras de estado incluidas

- `Buscador` diferencia error de servicio de una búsqueda sin coincidencias.
- Asistencia manual bloquea el botón durante el request para reducir dobles envíos.
- Pagos e inscripción muestran el mensaje normalizado del servicio.
- Las pantallas conservan sus loaders, alertas y estructura visual existentes.

## Pendientes deliberados

1. Autenticación y autorización server-side de cada webhook.
2. Activar el provider de token y decidir qué endpoints requieren credencial.
3. Roles/permisos y manejo uniforme de 401/403.
4. Idempotencia de inscripciones, pagos y asistencias.
5. Cancelación real de búsqueda y debounce; hoy se ignoran respuestas obsoletas, pero el request continúa.
6. Reintentos controlados y estados de resultado incierto.
7. Versionado formal de contratos y pruebas de contrato con fixtures reales anonimizados.
8. Retirar Axios del `package.json` una vez confirmado que ninguna integración externa pendiente lo necesita. Ya no se importa en `src`, pero eliminar dependencias se dejó fuera de esta fase para no mezclar cambios de lockfile preexistentes.

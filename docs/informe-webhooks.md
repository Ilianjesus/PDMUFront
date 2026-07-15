# Informe de webhooks y endpoints externos

Fecha de auditoría estática: 28 de junio de 2026.

## Alcance y criterio de manejo de configuración

Se revisaron `src/config`, `src/services/httpClient.js`, todos los adaptadores de `src/services/workflows` y `src/services/auth`, `AuthContext`, rutas, páginas, componentes consumidores, `.env.example`, configuración Firebase heredada y la documentación de `docs/`.

Este inventario se obtuvo leyendo código; **no se ejecutaron peticiones reales**. No se leyó ni se reproduce contenido de `.env.local`. Cuando una URL solo llega mediante una variable de entorno, este documento indica “configuración de despliegue no versionada”.

No se modificaron servicios, payloads, workflows, autenticación ni datos como parte de esta auditoría.

## Resumen ejecutivo

La aplicación tiene las siguientes fronteras externas:

1. **Siete URLs n8n configurables en el frontend** para búsqueda, inscripción, pagos, asistencia, administración, actualización/documentos y dashboard.
2. **Supabase Auth** bajo una única URL base pública, de la que el SDK deriva endpoints para solicitar/verificar OTP, renovar sesión y cerrar sesión.
3. **Un Supabase Send Email Hook server-to-server** hacia el webhook n8n `pdmu-otp`. React no conoce ni llama este endpoint.
4. **Un proveedor de correo detrás de n8n**, cuyo endpoint y contrato no existen en este repositorio y por ello no pueden inventariarse.
5. **Firebase Auth heredado**, con configuración versionada y adaptador presente, pero sin imports desde el flujo activo. No genera tráfico en la aplicación actual.

La centralización técnica es adecuada: páginas y componentes no usan `fetch` ni `import.meta.env`; las URLs viven en configuración, el transporte n8n en `httpClient.js` y los contratos en adaptadores por dominio. Sin embargo, la frontera de seguridad sigue abierta: todas las URLs `VITE_N8N_*` son públicas, no se adjunta `Authorization`, no hay evidencia en el repositorio de autorización server-side y operaciones sensibles dependen de valores manipulables como `sheet`, `operacion`, `row_number`, cantidad, año e ID.

Los riesgos de mayor prioridad son:

- **P0 — autorización:** lectura, edición y borrado administrativo sin token de sesión enviado por React.
- **P0 — minimización de datos:** la búsqueda descarga el padrón completo y filtra nombres en el navegador.
- **P0 — validación e idempotencia:** pagos, inscripciones y asistencias no envían clave idempotente; reintentos o doble ejecución pueden duplicar registros.
- **P0 — documentos/PII:** inscripción y carga documental aceptan información personal y PDFs desde un cliente no confiable.
- **P1 — acoplamiento:** un endpoint administrativo multiplexa recursos y operaciones mediante `sheet`/`operacion`; varios CRUD dependen de `row_number`.
- **P1 — reglas en cliente:** el pago se calcula como `meses × 200` y usa el año del dispositivo.
- **P1 — manejo OTP:** `requestEmailOtp` espera `signInWithOtp`, pero no inspecciona el campo `error` que Supabase devuelve en su resultado.

## Mapa de llamadas

```text
Navegador React
│
├─ Login
│  ├─ Supabase Auth POST /auth/v1/otp
│  │  └─ Supabase Send Email Hook (server-to-server)
│  │     └─ POST https://n8n.scolaris.com.mx/webhook/pdmu-otp
│  │        └─ proveedor de correo no visible en este repo
│  ├─ Supabase Auth POST /auth/v1/verify
│  ├─ Supabase Auth POST /auth/v1/token?grant_type=refresh_token
│  └─ Supabase Auth POST /auth/v1/logout?scope=local
│
├─ Home ── GET VITE_N8N_WEBHOOK_ESTATISTICS
├─ Inscripciones ── POST multipart VITE_N8N_WEBHOOK_INSCRIPCION
├─ Pagos
│  ├─ GET VITE_N8N_WEBHOOK_BUSCAR
│  └─ POST JSON VITE_N8N_WEBHOOK_PAGAR
├─ Asistencia manual / Scanner ── POST JSON VITE_N8N_WEBHOOK_ASISTENCIA
└─ Panel administrativo
   ├─ GET VITE_N8N_WEBHOOK_BUSCAR
   ├─ POST JSON VITE_N8N_WEBHOOK_ADMIN
   │  ├─ leer información/pagos/asistencias
   │  ├─ actualizar pagos/asistencias
   │  └─ eliminar elemento/pagos/asistencias
   └─ VITE_N8N_WEBHOOK_UPLOAD_DOCS
      ├─ POST JSON: editar un campo
      └─ POST multipart: cargar un PDF
```

`/Estadisticas` es actualmente una pantalla informativa; **no realiza llamadas externas**. El webhook de estadísticas alimenta Home, no esa ruta.

## Configuración y aliases

| Clave interna | Variable canónica | Alias aceptado | Presencia en `.env.example` | URL versionada |
|---|---|---|---|---|
| `searchElements` | `VITE_N8N_WEBHOOK_BUSCAR` | — | Sí | No |
| `registerPayment` | `VITE_N8N_WEBHOOK_PAGAR` | `VITE_N8N_WEBHOOK_PAGOS` | Solo la canónica | No |
| `admin` | `VITE_N8N_WEBHOOK_ADMIN` | — | Sí | No |
| `registerElement` | `VITE_N8N_WEBHOOK_INSCRIPCION` | — | Sí | No |
| `attendance` | `VITE_N8N_WEBHOOK_ASISTENCIA` | — | Sí | No |
| `uploadDocuments` | `VITE_N8N_WEBHOOK_UPLOAD_DOCS` | — | Sí | No |
| `dashboard` | `VITE_N8N_WEBHOOK_ESTATISTICS` | `VITE_N8N_WEBHOOK_STATISTICS` | Solo la variable con typo | No |
| Supabase | `VITE_SUPABASE_URL` | — | Sí | No |
| Supabase publishable key | `VITE_SUPABASE_PUBLISHABLE_KEY` | — | Sí | No aplica |

`PAGAR/PAGOS` y `ESTATISTICS/STATISTICS` son inconsistencias históricas. Los aliases existen en código, pero no en `.env.example` ni en los mensajes de validación: si solo se configura un alias, funciona, aunque el diagnóstico seguirá nombrando la variable canónica.

`getWorkflowUrl` exige `http:` o `https:`; la configuración Supabase exige HTTPS y una clave con prefijo `sb_publishable_`. En desarrollo se registran errores de variables n8n faltantes, pero el build no falla por configuración incompleta. La configuración Supabase sí falla al crear el cliente si falta o es inválida.

## Transporte común de workflows n8n

Todos los adaptadores n8n pasan por `src/services/httpClient.js`:

- Timeout predeterminado: **30 segundos**.
- Inscripción y carga de documentos: **60 segundos**.
- GET: sin body y sin headers añadidos por la app.
- POST JSON: `Content-Type: application/json` y `JSON.stringify(payload)`.
- POST `FormData`: el navegador construye el `Content-Type` y boundary; no se fuerza manualmente.
- No configura `credentials`; en llamadas cross-origin no envía cookies por defecto.
- `includeAccessToken` siempre queda en `false` y `setAccessTokenProvider` no tiene consumidores.
- No se envía `Authorization`, API key, firma, CSRF token ni idempotency key a n8n.
- La respuesta se lee primero como texto y se intenta parsear como JSON.
- JSON declarado pero inválido produce `INVALID_RESPONSE`.
- Timeout produce `TIMEOUT`; fallo de red, `NETWORK_ERROR`; HTTP 4xx, `HTTP_ERROR`; HTTP 5xx, `SERVER_ERROR`.
- En errores HTTP busca `message` en el objeto, `json`, primer elemento del array o `array[0].json`.

### Normalización común de negocio

`workflowResponse.js` reconoce:

- `status: "success"`.
- `status: "exito"` cuando el adaptador lo permite.
- Wrappers n8n `{ json: ... }`.
- Arrays `[ { json: ... } ]` cuando procede.
- HTTP 2xx sin `status` únicamente en adaptadores con `allowStatuslessSuccess`.

Resultado interno exitoso:

```js
{ ok: true, data, message, raw }
```

Resultado interno fallido:

```js
{ ok: false, code, message, raw }
```

Un HTTP 2xx no equivale automáticamente a éxito de negocio. Si falta un status aceptado y el adaptador no permite éxito sin status, se genera `BUSINESS_ERROR`. Un status como `already exists` se convierte en código estable `ALREADY_EXISTS`.

## Detalle de endpoints n8n

### 1. Búsqueda de elementos

**Identificación**

- Variable: `VITE_N8N_WEBHOOK_BUSCAR`.
- URL: configuración de despliegue no versionada.
- Tipo: webhook n8n de lectura.
- Servicio: `searchElements()` en `elementsWorkflow.js`.
- Consumidores: `Buscador`, usado en Registrar Pago y Panel Administrativo.

**Operación y sesión**

Descarga elementos para seleccionar una persona. Las pantallas están detrás de `RequireAuth`, por lo que la UI exige sesión Supabase; el webhook no recibe prueba de esa sesión.

**Método y formato**

- GET.
- Sin query, body ni headers propios.
- Cliente común, timeout 30 s.

**Payload y datos**

No envía payload. La respuesta se filtra en el navegador por nombre. Los campos consumidos son al menos:

```js
{ ID, Nombre, ApellidoPaterno, ApellidoMaterno }
```

**Respuesta esperada**

- Array directo de elementos; o
- `[ { json: [/* elementos */] } ]`.

No requiere `status`. Si no es un array se devuelve `INVALID_RESPONSE`. Array vacío es éxito y `Buscador` lo muestra como “sin resultados”; error de red se muestra por separado.

**Riesgo: alto**

- URL pública y sin autorización.
- Descarga potencialmente todo el padrón, incluso si el usuario escribe solo dos letras.
- La llamada no envía el término buscado; cada búsqueda debounced vuelve a descargar el conjunto.
- Puede exponer más columnas de las que la UI necesita, porque no hay proyección frontend.
- Riesgo de enumeración, scraping, latencia y escalabilidad.

**Recomendación**

P0: añadir autorización server-side y cambiar en una fase contractual posterior a búsqueda parametrizada, paginada y con respuesta mínima. Validar longitud de consulta, aplicar rate limit y auditar consultas. Si Supabase se adopta como base principal, esta lectura es candidata a una API/RPC con RLS; no conectar directamente el navegador hasta definir permisos.

### 2. Inscripción de elementos

**Identificación**

- Variable: `VITE_N8N_WEBHOOK_INSCRIPCION`.
- URL: configuración de despliegue no versionada.
- Tipo: webhook n8n de escritura y carga documental.
- Servicio: `registerElement()` en `elementsWorkflow.js`.
- Pantalla: Registrar Elemento / Inscripciones.

**Operación y sesión**

Crea una inscripción con datos personales y hasta seis archivos. La ruta requiere sesión en React, pero no se envía token al endpoint.

**Método y formato**

- POST `multipart/form-data` mediante `FormData`.
- Timeout 60 s.
- Sin `Authorization` ni idempotency key.

**Payload actual**

Campos de texto enviados siempre, incluso si están vacíos:

```text
nombre
apellidoPaterno
apellidoMaterno
grupo
fechaNacimiento
sexo
tutor
telefonoTutor
enfermedades
```

Archivos añadidos solo cuando existen:

```text
ineTutor
certificadoMedico
comprobanteDomicilio
actaNacimiento
curp
hojaInscripcion
```

Obligatorios inferidos por la UI: `nombre`, `apellidoPaterno`, `fechaNacimiento`, `sexo`, `tutor` y `telefonoTutor` de diez dígitos. `apellidoMaterno`, `enfermedades` y documentos parecen opcionales. `grupo` existe en estado y se envía, pero **no existe un control visible que lo capture**, por lo que actualmente sale vacío; debe confirmarse si es deuda de UI o campo obsoleto del contrato.

Datos sensibles: identidad, fecha de nacimiento, sexo, condiciones médicas, tutor, teléfono, identificadores oficiales y documentos PDF.

**Respuesta esperada**

- Éxito solo con `status: "success"`.
- `status: "already exists"` se vuelve `ALREADY_EXISTS` y tiene tratamiento específico en UI.
- Mensaje opcional en `message`.
- HTTP 2xx sin status se considera fallo de negocio.

**Riesgo: crítico**

- PII y posibles datos de salud/documentos desde un cliente manipulable.
- Validación PDF solo en navegador; MIME, tamaño, contenido y malware deben validarse server-side.
- Sin idempotencia: un timeout/reintento puede duplicar inscripción o archivos.
- No hay evidencia de límites de tamaño, retención, cifrado, control de acceso a URLs o auditoría.
- Un único request largo mezcla creación de entidad y seis cargas; una falla parcial puede dejar datos incompletos.

**Recomendación**

Mantener el contrato mientras se estabiliza, pero priorizar token validado, validación server-side exhaustiva, límite por archivo/total, allowlist de tipos, antivirus, almacenamiento privado, auditoría e idempotency key. A mediano plazo separar creación del expediente y documentos con estados transaccionales explícitos. Los metadatos son candidatos a Supabase; los documentos, a Storage privado con políticas, si se aprueba la migración.

### 3. Registro de pagos

**Identificación**

- Variable canónica: `VITE_N8N_WEBHOOK_PAGAR`.
- Alias: `VITE_N8N_WEBHOOK_PAGOS`.
- URL: configuración de despliegue no versionada.
- Tipo: webhook n8n de escritura financiera/administrativa.
- Servicio: `registerPayment()` en `paymentsWorkflow.js`.
- Pantalla: Registrar Pago.

**Método y formato**

- POST JSON.
- `Content-Type: application/json`.
- Timeout 30 s.
- Sin token ni idempotencia.

**Payload actual**

```js
{
  ID,
  Nombre,
  MesesPagados, // "Enero 2026, Febrero 2026"
  Cantidad,
  TipoPago      // "Efectivo" | "Transferencia"
}
```

Todos son obligatorios inferidos. `Nombre` se reconstruye en la UI; `MesesPagados` aplana un array a string; `Cantidad` se calcula en cliente como cantidad de meses × 200; el año viene del reloj del dispositivo.

Datos sensibles: identidad, relación de mensualidades, monto y medio de pago.

**Respuesta esperada**

Acepta `status: "exito"` o `status: "success"`; no acepta éxito sin status. `message` se muestra al operador. Errores de red y negocio se distinguen internamente.

**Riesgo: crítico**

- Monto, meses, nombre, año e ID pueden alterarse desde DevTools.
- La tarifa de 200 y el año son reglas sensibles calculadas en cliente.
- Sin idempotencia: doble clic, reintento o replay puede duplicar pagos.
- El string `MesesPagados` dificulta validación, deduplicación y consultas.
- No hay evidencia de conciliación, folio, operador, timestamp confiable ni auditoría inmutable.

**Recomendación**

P0: el backend debe resolver identidad por ID, calcular tarifa/periodos permitidos, rechazar duplicados y registrar actor. Añadir idempotency key/folio, token validado y log de auditoría. Pagos son prioridad alta para futura persistencia transaccional en Supabase; n8n puede seguir orquestando notificaciones/reportes.

### 4. Registro de asistencia manual y QR

**Identificación**

- Variable: `VITE_N8N_WEBHOOK_ASISTENCIA`.
- URL: configuración de despliegue no versionada.
- Tipo: webhook n8n de escritura.
- Servicio: `registerAttendance()` en `attendanceWorkflow.js`.
- Pantallas: Registrar Asistencia y Scanner QR.

**Método, formato y payload**

- POST JSON, timeout 30 s.
- Payload único:

```js
{ ID }
```

El ID es obligatorio inferido. Manual y QR comparten exactamente el contrato. No se envía origen manual/QR, timestamp del cliente, operador ni idempotency key.

**Respuesta esperada**

Acepta `status: "success"`, `status: "exito"` o HTTP 2xx sin status. La UI distingue error de red. El scanner bloquea duplicados concurrentes en memoria y no reenvía un ID ya exitoso durante esa sesión de pantalla, pero esto no sustituye idempotencia server-side.

**Riesgo: alto**

- Cualquier cliente que conozca la URL puede registrar un ID arbitrario.
- Replay y duplicados entre pestañas/dispositivos siguen posibles.
- No hay prueba enviada del operador, ubicación, dispositivo o modo de captura.
- Aceptar cualquier 2xx sin status puede ocultar respuestas incompletas.

**Recomendación**

Token validado, rate limit, ventana de deduplicación e idempotency key por elemento/evento. El servidor debe generar fecha/hora y validar si el registro es permitido. Conservar n8n a corto plazo; asistencia es candidata a tabla transaccional en Supabase en una fase posterior, con n8n como orquestador.

### 5. Endpoint administrativo multiplexado

**Identificación**

- Variable: `VITE_N8N_WEBHOOK_ADMIN`.
- URL: configuración de despliegue no versionada.
- Tipo: webhook n8n de lectura, actualización y eliminación.
- Servicios: `readAdminModule`, `executeAdminOperation`, `deleteElement`; reutilizado por `paymentsWorkflow` y `attendanceWorkflow`.
- Pantallas: Panel Administrativo, Módulo Información, Módulo Pagos y Módulo Asistencias.

**Método y formato**

- Todas las operaciones usan POST JSON, incluso lecturas y borrados.
- Timeout 30 s.
- Sin token, credenciales ni idempotencia.

**Payloads actuales**

Lectura:

```js
{ sheet, operacion: "leer", ID }
```

Mapeo de `sheet`: `Informacion → "elementos"`, `Pagos → "Pagos"`, `Asistencias → "Asistencias"`.

Eliminar expediente:

```js
{ sheet: "elementos", operacion: "delete", ID }
```

Actualizar pago:

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

Eliminar pago:

```js
{
  sheet: "Pagos",
  operacion: "delete",
  ID,
  datos: { row_number, "ID Pago" }
}
```

Actualizar asistencia:

```js
{
  sheet: "Asistencias",
  operacion: "update",
  ID,
  datos: { row_number, Estado, Tipo, FechaHora }
}
```

Eliminar asistencia:

```js
{
  sheet: "Asistencias",
  operacion: "delete",
  ID,
  datos: { row_number }
}
```

Los identificadores, `sheet`, `operacion`, `row_number` y todos los valores editados vienen del navegador.

**Respuesta esperada**

- Lectura acepta `status: "success"` o respuesta 2xx sin status; selecciona `response.data ?? response` y exige objeto no nulo.
- El panel interpreta `{}` como “sin datos”.
- Formas inferidas por consumidores:
  - Información: objeto con `ID`, datos personales y enlaces documentales.
  - Pagos: `{ "ID Elemento", "Nombre Elemento", pagos: [...] }`.
  - Asistencias: `{ "ID Elemento", "Nombre Elemento", Asistencias: [...] }`.
- Actualización/eliminación requiere `status: "success"`; `data` es opcional para la UI.

**Riesgo: crítico**

- Un solo endpoint expone lectura y borrado de múltiples recursos.
- `sheet` y `operacion` manipulables amplían el impacto si n8n no aplica allowlists estrictas.
- `row_number` acopla el frontend al orden físico de Sheets; inserciones/ordenamientos pueden apuntar a otra fila.
- Borrado de expediente potencialmente irreversible sin autorización server-side.
- No hay control de concurrencia/versionado; una edición puede sobrescribir cambios recientes.
- No hay actor, motivo, before/after ni auditoría demostrable.

**Recomendación**

Es la primera integración que debe endurecerse. Validar JWT/roles, usar allowlist cerrada de recursos/operaciones y reemplazar `row_number` por IDs inmutables. Añadir auditoría before/after y control de versión. En una fase contractual, dividir lectura, actualización y eliminación por recurso o colocar una API controlada delante de n8n. Los datos administrativos son fuertes candidatos a Supabase; n8n puede conservar la orquestación.

### 6. Actualización de información y documentos

**Identificación**

- Variable: `VITE_N8N_WEBHOOK_UPLOAD_DOCS`.
- URL: configuración de despliegue no versionada.
- Tipo: webhook n8n mixto para actualización y archivo.
- Servicios: `updateElementField()` y `uploadElementDocument()` en `elementsWorkflow.js`.
- Pantalla: Módulo Información dentro del Panel Administrativo.

**Operación A — editar campo**

- POST JSON, timeout 30 s.
- Payload:

```js
{ ID, field, value }
```

Campos editables actuales: `Nombres`, `ApellidoPaterno`, `ApellidoMaterno`, `Enfermedades`, `FechaNacimiento`, `Tutor`, `TelefonoTutor`. El nombre de campo viaja como string; el endpoint debe aplicar una allowlist y validación por campo.

Respuesta: requiere `status: "success"`.

**Operación B — cargar documento**

- POST `FormData`, timeout 60 s.
- Payload:

```text
file
documentType
ID
```

Tipos actuales: `ineTutor`, `certificadoMedico`, `comprobanteDomicilio`, `actaNacimiento`, `curp`, `hojaInscripcion`.

Respuesta: acepta `status: "success"` o 2xx sin status, pero exige `url` string en el payload normalizado.

**Riesgo: crítico**

- El mismo endpoint interpreta JSON y multipart con responsabilidades distintas.
- `field` y `documentType` son manipulables.
- PII, datos médicos e identificadores oficiales.
- Validación PDF solo en cliente; no hay prueba de límites, antivirus ni almacenamiento privado.
- La URL devuelta podría ser pública, persistente o apuntar a un dominio no confiable; el frontend solo comprueba que comience con HTTP(S) al mostrarla posteriormente.
- Sin idempotencia, auditoría ni control de versiones.

**Recomendación**

P0: token/rol, allowlists, validación server-side por esquema, tamaño/MIME/firma real del archivo, antivirus, almacenamiento privado y URLs firmadas con expiración. Separar actualización de campos y documentos en una fase posterior. Registrar actor, tipo, hash y resultado de cada carga. Supabase Storage privado es candidato futuro, no una conexión directa inmediata.

### 7. Dashboard / resumen de Home

**Identificación**

- Variable canónica: `VITE_N8N_WEBHOOK_ESTATISTICS`.
- Alias: `VITE_N8N_WEBHOOK_STATISTICS`.
- URL: configuración de despliegue no versionada.
- Tipo: webhook n8n de lectura agregada.
- Servicio: `getDashboardSummary()` en `dashboardWorkflow.js`.
- Pantalla: Home. La ruta Estadísticas no lo consume actualmente.

**Método y formato**

- GET sin payload, timeout 30 s.
- Sin token ni headers propios.

**Respuesta esperada**

```js
{
  status: "success",
  data: {
    resumenRapido: {
      elementosActivos,
      pagosPendientes,
      asistenciasHoy,
      faltasHoy
    },
    alertasImportantes: [string | { texto }],
    actividadReciente: [string | { texto }]
  }
}
```

Requiere `status: "success"`. Si `data` falta, el adaptador usa `{}` y lo considera válido; Home muestra guiones y estados vacíos. Si el request falla, Home muestra un error con reintento.

**Riesgo: medio-alto**

- URL pública y sin autorización.
- Puede revelar métricas, morosidad, incidencias o actividad sensible.
- No hay parámetros de periodo, zona horaria o alcance; la semántica depende totalmente de n8n.
- El fallback `{}` puede convertir una respuesta incompleta en aparente “sin datos”.
- Typo `ESTATISTICS` aumenta riesgo de configuración divergente.

**Recomendación**

Autorizar y minimizar información según rol. Versionar esquema y exigir campos base o un indicador explícito de “sin datos”. Definir zona horaria/frescura y observabilidad. Puede seguir en n8n como agregador incluso si los datos migran a Supabase.

## Supabase Auth

### Base y cliente

- Variable: `VITE_SUPABASE_URL`.
- Clave pública: `VITE_SUPABASE_PUBLISHABLE_KEY`.
- URL real: no se reproduce; se obtiene de configuración local/de despliegue y `.env.example` está vacío.
- Cliente: `src/services/auth/supabaseClient.js` con `@supabase/supabase-js`.
- Opciones: `autoRefreshToken`, `persistSession` y `detectSessionInUrl` activadas.
- No se llama `.from()`, Storage, Functions ni `/rest/v1`; solo Auth.

La publishable key es pública por diseño, no un secreto. El SDK la envía como `apikey` y como credencial pública en headers de Auth. Los endpoints autenticados usan además el access token de sesión cuando corresponde.

### 8. Solicitud OTP

- Endpoint derivado por SDK: `${VITE_SUPABASE_URL}/auth/v1/otp`.
- Método: POST JSON.
- Servicio: `requestEmailOtp()`.
- Pantalla: Login, solicitud inicial y reenvío.
- Payload de alto nivel:

```js
{
  email: correoNormalizado,
  options: { shouldCreateUser: false }
}
```

En wire, el SDK traduce a campos como `email`, `data: {}`, `create_user: false` y metadatos de seguridad/PKCE según configuración. El correo se normaliza con trim y minúsculas.

Respuesta esperada por SDK: `{ data, error }`. La app devuelve siempre un mensaje genérico para evitar enumeración. **Hallazgo:** `requestEmailOtp` hace `await signInWithOtp(...)`, pero no desestructura ni valida `error`; muchos errores Supabase se devuelven como resultado en vez de lanzar excepción. Esto puede llevar la UI al paso de código aunque Supabase haya rechazado la solicitud.

Riesgos: abuso/rate limiting, enumeración por tiempos, dependencia del hook de correo y manejo incompleto del error. Recomendación P1: clasificar fallos técnicos sin revelar existencia del usuario, mantener respuesta pública genérica y añadir telemetría server-side.

### 9. Verificación OTP

- Endpoint derivado: `${VITE_SUPABASE_URL}/auth/v1/verify`.
- Método: POST JSON.
- Servicio: `verifyEmailOtp()`.
- Pantalla: Login, segundo paso.
- Payload:

```js
{ email: correoNormalizado, token: codigoNormalizado, type: "email" }
```

React elimina espacios, guiones y caracteres no numéricos; la UI acepta de 6 a 8 dígitos. Supabase devuelve usuario y sesión con access/refresh token. La app valida `error` y existencia de `data.session`, persiste la sesión mediante el SDK y normaliza únicamente `{ uid, email, displayName, provider: "supabase-otp" }` para el resto de React.

Riesgos: brute force y replay dependen de rate limits/expiración de Supabase; errores de UI se agrupan como inválido/expirado. Recomendación: mantener Supabase como autoridad, comprobar límites reales, alertas de abuso y configuración de expiración.

### 10. Renovación de sesión

- Endpoint derivado cuando se necesita red: `${VITE_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`.
- Método: POST JSON con `refresh_token` gestionado por el SDK.
- Activación: automática por `autoRefreshToken`; también `getAccessToken(true)` llama `refreshSession()`.
- `getAccessToken(false)` y `getCurrentSupabaseSession()` normalmente leen la sesión persistida; si está cerca de expirar el SDK puede renovarla.

La sesión se guarda en almacenamiento del navegador por `persistSession`. Riesgo: un XSS podría acceder a credenciales persistidas; la defensa depende de evitar inyección, CSP y dependencias confiables. `getAccessToken` está expuesto por AuthContext, pero todavía no se conecta al cliente n8n.

### 11. Logout

- Endpoint derivado: `${VITE_SUPABASE_URL}/auth/v1/logout?scope=local` cuando existe access token.
- Método: POST.
- Servicio: `logoutSupabaseSession()`.
- Consumidor: `AuthenticatedShell`.
- Credencial: access token de la sesión Supabase, gestionado por SDK.

Después se elimina la sesión local. Errores 401/403/404 pueden ser tolerados internamente por el SDK para permitir limpieza local; otros errores se muestran como fallo de logout.

### Observación y sesión inicial

`onAuthStateChange` es una suscripción interna del SDK y sincroniza eventos/local storage; no es un webhook n8n. `getSession` consulta almacenamiento local y no es validación server-side de autorización. `RequireAuth` protege navegación, pero no autoriza workflows externos.

## Supabase Send Email Hook hacia n8n

### 12. `pdmu-otp` — endpoint indirecto server-to-server

- URL versionada en documentación: `https://n8n.scolaris.com.mx/webhook/pdmu-otp`.
- Tipo: Supabase Auth Send Email Hook HTTPS → n8n.
- Variable frontend: ninguna; correctamente no es `VITE_*`.
- Consumidor: infraestructura Supabase Auth, no React.
- Operación: entregar a n8n el evento necesario para enviar el correo OTP.
- Método: POST JSON.
- Sesión React: no aplica.
- Credencial esperada: firma/secreto de Standard Webhooks configurado en Supabase; su validación ocurre fuera de este repo y no puede confirmarse aquí.

Payload observado/documentado en una ejecución n8n:

```text
body.user.email
body.email_data.token
body.email_data.email_action_type
```

El esquema base documentado incluye además `token_hash`, `redirect_to`, `site_url`, `token_new` y `token_hash_new` según el tipo de acción. La prueba reportada recibió `email_action_type: "magiclink"`; n8n no debe asumir que el valor será literalmente `login`.

Respuesta esperada: HTTP 200 después de aceptar la entrega; una respuesta fallida hace que Supabase marque error de envío. React no ve directamente esta respuesta: recibe el resultado de `signInWithOtp`.

**Riesgo: crítico si no valida firma**

- OTP y correo son credenciales/datos sensibles en tránsito.
- La URL por sí sola no autentica a Supabase.
- Execution logs de n8n pueden persistir el token.
- Replays o acciones de recovery/cambio de correo podrían activar plantillas incorrectas.
- El proveedor final de correo y sus garantías no son visibles en el repo.

**Recomendación**

Validar firma y timestamp/replay, allowlist de acciones, redacción de token en logs, timeout/reintentos controlados, respuesta 200 solo al aceptar envío y métricas sin PII. Este hook debe permanecer server-side en Supabase/n8n; nunca debe ser invocado por React ni trasladarse a `VITE_*`.

## Firebase heredado y otros externos

### 13. Firebase Auth — código inactivo

`src/firebase.js` contiene configuración pública versionada para el proyecto heredado, incluyendo `pdmuappweb.firebaseapp.com` y `pdmuappweb.firebasestorage.app`, además de identificadores y una API key que este informe deliberadamente no reproduce. `src/services/auth/firebaseAuth.js` implementa login email/password, observación, logout y token.

No existe ningún import del adaptador Firebase desde AuthContext o las rutas actuales; por tanto, **no hay endpoints Firebase activos en el bundle funcional de login**. Si se importara, el SDK conectaría con servicios Google Identity Toolkit/Secure Token derivados de esa configuración.

Riesgos: dependencia y configuración antiguas aumentan superficie/confusión; la API key Firebase no es una secret key tradicional, pero debe tener restricciones correctas. Recomendación: confirmar que no se necesita rollback y retirar código/dependencia/configuración en una tarea separada; revisar o deshabilitar proveedores Firebase no usados desde consola.

### Proveedor de correo

n8n es responsable de llamar al proveedor configurado por el dueño para enviar correo. No hay URL, credencial, nodo ni contrato de ese proveedor en este repositorio. Solo puede registrarse como dependencia externa **no inventariable desde React**.

No se detectaron analytics, CDN de runtime, fuentes remotas, mapas, APIs de terceros ni otras llamadas `fetch`/XHR en páginas o componentes.

## Pantallas y dependencias

| Vista | Endpoint(s) | Comportamiento ante fallo |
|---|---|---|
| Login | Supabase `/otp`, `/verify`; indirectamente Send Email Hook | Mensaje genérico de solicitud; error claro en verificación. Existe el hallazgo de error no inspeccionado en solicitud. |
| Home/Dashboard | `VITE_N8N_WEBHOOK_ESTATISTICS` / alias | Distingue error, permite reintentar; `data` vacío puede parecer sin información. |
| Inscripciones | `VITE_N8N_WEBHOOK_INSCRIPCION` | Bloquea doble submit; distingue existente, error de negocio y conexión. |
| Registrar Pago | BUSCAR + PAGAR/PAGOS | Búsqueda distingue vacío/error; registro muestra éxito/error y evita doble submit. |
| Asistencia manual | ASISTENCIA | Valida ID local, muestra éxito/error y evita doble submit. |
| Scanner QR | ASISTENCIA | Muestra cámara/red; bloquea duplicado local durante la sesión. |
| Panel administrativo | BUSCAR + ADMIN | Distingue búsqueda vacía/error; lectura vacía se informa; operaciones tienen confirmación. |
| Módulo Información | UPLOAD_DOCS | Mensajes de edición/carga; conserva el archivo ante fallo para reintento. |
| Módulo Pagos | ADMIN | Mensajes de edición/borrado; estado local cambia solo tras éxito. |
| Módulo Asistencias | ADMIN | Revierte edición local fallida; distingue vacío/error. |
| Estadísticas | Ninguno | Placeholder; no consulta el dashboard. |
| Logout/shell | Supabase `/logout`; refresh automático | Informa error de logout; guard depende de sesión local normalizada. |

## Matriz final de prioridad

| Variable / Endpoint | Servicio frontend | Módulo | Método | Formato | Tipo de operación | Datos sensibles | Riesgo | Prioridad | Recomendación |
|---|---|---|---|---|---|---|---|---|---|
| `VITE_N8N_WEBHOOK_BUSCAR` | `searchElements` | Pagos/Admin | GET | Sin body | Lectura | Identidad/padrón | Alto | P0 | Token, búsqueda server-side, proyección mínima, paginación y rate limit. |
| `VITE_N8N_WEBHOOK_INSCRIPCION` | `registerElement` | Inscripciones | POST | FormData | Escritura/carga | PII, salud, documentos | Crítico | P0 | JWT/rol, validación de archivos, almacenamiento privado, auditoría e idempotencia. |
| `VITE_N8N_WEBHOOK_PAGAR` (`PAGOS`) | `registerPayment` | Pagos | POST | JSON | Escritura financiera | Monto, periodos, identidad | Crítico | P0 | Calcular server-side, deduplicar, folio/idempotencia, actor y persistencia transaccional. |
| `VITE_N8N_WEBHOOK_ASISTENCIA` | `registerAttendance` | Manual/Scanner | POST | JSON | Escritura | ID y presencia | Alto | P0 | JWT, timestamp server-side, deduplicación, rate limit e idempotencia. |
| `VITE_N8N_WEBHOOK_ADMIN` lectura | `readAdminModule` | Admin | POST | JSON | Lectura | Expediente/pagos/asistencia | Crítico | P0 | JWT/roles, allowlist y endpoints/acciones acotados. |
| `VITE_N8N_WEBHOOK_ADMIN` update/delete | `executeAdminOperation` | Admin | POST | JSON | Actualización/borrado | Datos administrativos | Crítico | P0 | IDs inmutables, control de concurrencia, auditoría before/after y separar operaciones. |
| `VITE_N8N_WEBHOOK_UPLOAD_DOCS` JSON | `updateElementField` | Información | POST | JSON | Actualización | PII/salud/contacto | Crítico | P0 | Allowlist por campo, esquema server-side, roles y auditoría. |
| `VITE_N8N_WEBHOOK_UPLOAD_DOCS` multipart | `uploadElementDocument` | Documentos | POST | FormData | Carga | Documentos oficiales | Crítico | P0 | MIME/tamaño/AV, Storage privado, URL firmada, hash y auditoría. |
| `VITE_N8N_WEBHOOK_ESTATISTICS` (`STATISTICS`) | `getDashboardSummary` | Home | GET | Sin body | Lectura agregada | Métricas/incidencias | Medio-alto | P1 | Autorizar, versionar esquema, definir frescura/zona horaria. |
| Supabase `/auth/v1/otp` | `requestEmailOtp` | Login | POST | JSON | Autenticación | Correo | Alto | P1 | Inspeccionar `error` sin enumerar, monitorizar abuso y rate limit. |
| Supabase `/auth/v1/verify` | `verifyEmailOtp` | Login | POST | JSON | Autenticación | Correo, OTP, sesión | Alto controlado | Mantener | Mantener autoridad Supabase; vigilar expiración/intentos. |
| Supabase refresh/logout | adaptador Supabase | Sesión | POST | JSON / token | Sesión | Refresh/access token | Alto controlado | Mantener | CSP/XSS, rotación gestionada por SDK y no registrar tokens. |
| `pdmu-otp` Send Email Hook | Ninguno en React | Login indirecto | POST | JSON firmado | Entrega OTP | Correo y OTP | Crítico | P0 | Validar firma/replay, redactar logs, allowlist de acción y observabilidad. |
| Firebase heredado | Ninguno activo | Ninguno | SDK | SDK | Auth legado | Identidad/token si se reactivara | Bajo actual | P2 | Confirmar retiro y eliminar en tarea separada. |

## Orden recomendado para mejorar la lógica

### Fase 1 — cerrar frontera de seguridad

1. Definir cómo n8n o una API delante de n8n validará el JWT Supabase.
2. Conectar `getAccessToken` al cliente solo después de acordar el contrato y validación server-side.
3. Autorizar por operación/recurso, no únicamente por sesión.
4. Priorizar ADMIN, UPLOAD_DOCS, INSCRIPCION y PAGAR.
5. Validar firma/replay del Send Email Hook y redactar OTP de logs.

### Fase 2 — integridad y observabilidad

1. Idempotency keys para pagos, inscripciones y asistencias.
2. IDs inmutables en lugar de `row_number`.
3. Auditoría con actor, operación, recurso, before/after, timestamp y correlation ID.
4. Esquemas server-side por payload y respuestas estables versionadas.
5. Métricas de latencia/error sin PII y trazabilidad React → n8n → almacenamiento.

### Fase 3 — reducir acoplamiento y exposición

1. Búsqueda parametrizada y mínima.
2. Separar administración genérica por recurso/operación o encapsularla en una API.
3. Separar actualización de campos y documentos.
4. Mover tarifa, periodos y timestamps a lógica confiable.
5. Normalizar `success/exito`, aliases y nombres de campo solo mediante una migración contractual coordinada.

### Fase 4 — persistencia futura

Orden sugerido si se decide Supabase: operadores/roles y auditoría; pagos; asistencias; inscripciones; documentos. n8n puede seguir como orquestador. React no debe conectarse directamente a operaciones sensibles hasta disponer de RLS, permisos, esquemas y auditoría.

## Decisiones pendientes del dueño

1. ¿Qué capa validará access tokens Supabase: n8n directamente o un gateway/backend?
2. ¿Qué roles pueden leer, editar y borrar cada recurso?
3. ¿Los workflows actuales ya aplican allowlists de `sheet`, `operacion`, `field` y `documentType`?
4. ¿Cómo se previenen hoy pagos/asistencias duplicados?
5. ¿`grupo` sigue siendo parte obligatoria de inscripción?
6. ¿Dónde se almacenan los PDFs, con qué visibilidad, retención y límites?
7. ¿n8n valida actualmente la firma del Send Email Hook y elimina OTP de execution logs?
8. ¿Las URLs de workflows rotan o se han tratado históricamente como secretos?
9. ¿Qué zona horaria y fuente de tiempo deben gobernar pagos y asistencias?
10. ¿Cuándo puede retirarse definitivamente Firebase heredado?

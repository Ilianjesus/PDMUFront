# Auditoría técnica de PDMU APP

Fecha de revisión: 28 de junio de 2026  
Alcance: frontend React/Vite, integración Firebase y consumo de workflows externos.  
Restricción respetada: no se modificó lógica de negocio ni se asumieron cambios posibles en n8n.

> Nota de seguimiento: este documento conserva el diagnóstico base anterior a las refactorizaciones. La frontera de sesión P0 y la capa de workflows P1 ya fueron implementadas; su estado vigente está documentado en `docs/frontera-acceso.md` y `docs/integracion-workflows.md`.

## 1. Resumen ejecutivo

PDMU APP es un prototipo funcional avanzado, de tamaño pequeño y todavía organizado como una sola aplicación frontend. Los tres procesos centrales ya tienen recorridos utilizables: alta de elementos con documentos, registro y administración de mensualidades, y registro/administración de asistencias (manual y por QR). También existe un panel administrativo y un tablero inicial conectado a un webhook.

El proyecto **compila**, pero todavía no tiene una base suficientemente segura ni estable para considerarlo listo para producción administrativa. El riesgo principal no es visual: es la frontera de autorización. Varias rutas con operaciones sensibles (`/RegistrarPago`, `/PanelAdmin`, `/Scanner` y los módulos administrativos) no están protegidas por `RequireAuth`, y ninguna llamada a los webhooks transmite una credencial o token de Firebase. Por tanto, el login actual controla parte de la navegación, pero el repositorio no demuestra autorización real de las operaciones CRUD. Las URLs `VITE_*`, además, quedan incorporadas al JavaScript que recibe el navegador; deben considerarse públicas.

La segunda debilidad es el acoplamiento directo entre componentes y contratos externos no uniformes. Se mezclan `fetch` y `axios`, JSON y `FormData`, respuestas `success` y `exito`, y diferentes nombres para el mismo concepto. No existe una capa de servicios, esquemas de validación, tipos ni una convención común de error. Esto hace que cualquier ajuste de contrato afecte pantallas completas.

La tercera debilidad es de calidad operativa: no hay pruebas, el lint falla, el CI solo construye/despliega, no hay timeout ni cancelación real de peticiones, las validaciones son parciales y hay lógica de importes/meses confiada al cliente. El diseño sí muestra una intención mobile-first consistente en colores y tarjetas, pero el CSS global y las colisiones de clases ya producen fragilidad.

Diagnóstico global: **MVP funcional / preproducción**, con avance visual y CRUD apreciable, pero con deuda alta en seguridad, contratos, manejo de red y mantenibilidad.

## 2. Alcance y método de revisión

Se revisaron todos los archivos fuente, configuración de Vite/ESLint, dependencias, workflow de GitHub Pages, variables de entorno por nombre (sin registrar sus valores), historial reciente y estado de Git. También se ejecutaron:

- `npm run build`: exitoso; bundle JS principal de 890.97 kB minificado (258.21 kB gzip), con advertencia por superar 500 kB.
- `npm run lint`: fallido; 5 errores y 2 advertencias.
- `npm ls --depth=0`: árbol de dependencias instalado sin errores reportados.

No existen pruebas automatizadas ni scripts de test. El repositorio tenía cambios locales previos en `package.json`, `package-lock.json` y `src/pages/RegistrarElemento.jsx`; se preservaron intactos.

## 3. Mapa de arquitectura actual

```text
main.jsx
└── App.jsx
    ├── AuthProvider (Firebase Authentication)
    └── HashRouter
        ├── /login                         pública
        ├── Layout + RequireAuth
        │   ├── /home                      dashboard por webhook
        │   ├── /RegistrarElemento         inscripción multipart
        │   ├── /registrar-asistencia      asistencia manual
        │   └── /Estadisticas              placeholder
        └── rutas fuera de Layout/guard
            ├── /Scanner                   asistencia QR
            ├── /RegistrarPago             alta de pagos
            ├── /PanelAdmin                búsqueda + CRUD
            ├── /ModuloInfo                ruta directa sin datos
            ├── /ModuloPagos               ruta directa sin datos
            └── /ModuloAsistencias          ruta directa sin datos

Componentes de negocio
├── Buscador ─────────────── GET webhook de elementos completo
├── PanelAdmin ───────────── POST webhook administrativo
├── ModuloInfo ───────────── POST JSON/FormData a webhook de documentos
├── ModuloPagos ──────────── POST update/delete administrativo
└── ModuloAsistencias ────── POST update/delete administrativo

Infraestructura local
├── firebase.js ──────────── initializeApp + getAuth
├── AuthContext.jsx ──────── login/logout/observador de sesión
├── styles/*.css ─────────── CSS global por importación
└── .github/workflows ────── build y deploy a GitHub Pages
```

### Estructura y separación de responsabilidades

- `src/pages` contiene pantallas, aunque `PanelAdmin` funciona como página y está en `components`.
- `src/components` mezcla componentes de presentación, guards, layout, acceso a red y lógica de negocio.
- No existen carpetas `services`, `api`, `hooks`, `schemas`, `utils`, `config` o `features`; todos los componentes leen `import.meta.env` directamente.
- No hay modelos o tipos compartidos. Los contratos se infieren de strings y propiedades de objetos.
- `ModuloInfo`, `ModuloPagos` y `ModuloAsistencias` se publican como rutas independientes aunque requieren `data` para funcionar. Esas rutas directas producen pantallas vacías o incompletas y no parecen intencionales.
- `Navigation.jsx`, `App.css`, `index.css` y el SVG de React parecen residuos del template o código no utilizado. `Estadisticas.jsx` es explícitamente un placeholder.
- `PanelAdmin.handleOperacion` y la prop `onOperacion` que pasa a los módulos no son consumidos: los tres módulos vuelven a llamar a webhooks por su cuenta. Es una centralización iniciada pero inconclusa.

### Patrones inconsistentes

- Rutas en minúsculas y PascalCase mezcladas.
- Componentes exportados con export nombrado y default sin convención.
- `fetch` y `axios` para el mismo tipo de integración.
- Alertas nativas, `window.confirm`, mensajes inline, modal propio y SweetAlert2 para feedback equivalente.
- Español e inglés mezclados en nombres (`loading`, `step`, `data`, `handleFinalizar`, `sheet`, `operacion`).
- Campos externos en lower camel case, PascalCase, nombres con espacios y acentos.

## 4. Firebase y autenticación actual

### Uso encontrado

Firebase se inicializa una sola vez en `src/firebase.js` mediante `initializeApp(firebaseConfig)` y se exporta `auth = getAuth(app)`. La configuración está escrita directamente en el fuente.

Authentication usa:

- `signInWithEmailAndPassword` para login.
- `signOut` para cerrar sesión.
- `onAuthStateChanged` para hidratar `user`.
- `browserSessionPersistence`, configurada desde `AuthContext.jsx`.
- `RequireAuth` para bloquear cuatro rutas.

No se encontró uso de Firestore, Realtime Database, Firebase Storage, Cloud Functions, Messaging, Analytics ni App Check. Aunque existe `storageBucket` en la configuración, los documentos se envían a webhooks y no al SDK de Storage.

### Dependencias y fragilidad

- `Login.jsx` depende directamente de que `AuthContext.login` acepte correo/contraseña.
- `AuthContext` expone un objeto Firebase `user` como definición implícita de sesión.
- `RequireAuth` considera autenticado a quien tenga `user`; no hay roles, claims ni permisos por módulo.
- La persistencia es de sesión del navegador, pero `login` también escribe `isLoggedIn=true` en `localStorage`. Ese flag no se lee en ningún sitio y puede sobrevivir a la sesión, por lo que es estado muerto y confuso, aunque hoy no concede acceso.
- La promesa de `setPersistence` se ejecuta a nivel de módulo sin `await` ni captura de error; puede generar una carrera con el primer login o un rechazo no controlado.
- Existe `logout`, pero no hay ningún botón o flujo visible que lo invoque.
- Un usuario autenticado puede seguir abriendo `/login`; no existe redirección inversa.
- La configuración pública de Firebase no es por sí sola un secreto (es normal en aplicaciones web), pero faltan en el repositorio garantías verificables sobre dominios autorizados, restricciones de API, cuotas, política de contraseñas o controles del proyecto Firebase. Eso se debe auditar en consola.

### Riesgo de autorización

`RequireAuth` solo es un control de interfaz. En el código revisado, ninguna petición a n8n usa `user.getIdToken()`, encabezado `Authorization`, cookie de sesión u otra prueba de identidad. Incluso las rutas que sí están bajo el guard llaman endpoints como cliente anónimo. Si los webhooks tampoco validan fuera del frontend, cualquier persona que conozca la URL podría leer o alterar datos. No se puede verificar la configuración externa desde este repositorio, por lo que esto debe tratarse como un riesgo crítico pendiente de confirmar.

## 5. Workflows y webhooks externos

No hay URLs literales de n8n en `src`; se usan variables de entorno. Es mejor que hardcodearlas, pero todas las variables con prefijo `VITE_` se sustituyen durante el build y son visibles en el navegador. No deben contener secretos ni funcionar como único mecanismo de autorización.

| Variable | Consumidor | Método/formato | Contrato observado |
|---|---|---|---|
| `VITE_N8N_WEBHOOK_BUSCAR` | `Buscador` | GET | Espera un array completo de elementos y filtra en cliente. |
| `VITE_N8N_WEBHOOK_PAGAR` | `RegistrarPago` | POST JSON | Envía ID, nombre, meses como string, cantidad y tipo; espera `status: "exito"`. |
| `VITE_N8N_WEBHOOK_ADMIN` | `PanelAdmin`, pagos y asistencias | POST JSON | Usa `sheet`, `operacion`, `ID`, `datos`; espera principalmente `status: "success"`. |
| `VITE_N8N_WEBHOOK_INSCRIPCION` | `RegistrarElemento` | POST FormData | Envía datos personales y hasta seis PDFs; acepta `success` o `already exists`. |
| `VITE_N8N_WEBHOOK_ASISTENCIA` | asistencia manual y QR | POST JSON | Envía `{ ID }`; la pantalla manual solo confía en HTTP 2xx. |
| `VITE_N8N_WEBHOOK_UPLOAD_DOCS` | `ModuloInfo` | POST JSON o FormData | El mismo endpoint actualiza campos y sube documentos; espera `success` y/o `url`. |
| `VITE_N8N_WEBHOOK_ESTATISTICS` | `Home` | GET | Espera `{ status: "success", data: ... }`. El nombre contiene el typo `ESTATISTICS`. |

### Hallazgos de integración

1. **Contratos divergentes.** Se usan `success`, `exito`, `already exists`, HTTP 2xx sin status de negocio y una normalización especial de respuestas n8n solo dentro de `PanelAdmin`.
2. **Payloads divergentes.** Ejemplos: `nombre` frente a `Nombre`/`Nombres`; `TipoPago` frente a `"Tipo de Pago"`; `fechaNacimiento` frente a `FechaNacimiento`; `ID` frente a `"ID Elemento"`; `Año` y `row_number`.
3. **Sin autenticación observable.** No se envía token de Firebase ni credencial de sesión.
4. **Sin timeout/reintento/idempotencia.** Una conexión colgada puede dejar la UI cargando indefinidamente. En altas, pagos y asistencias, reintentar tras una respuesta perdida puede duplicar registros si el receptor no deduplica.
5. **Errores inconsistentes.** `Buscador` silencia la excepción y muestra “no se encontraron resultados”; otras pantallas usan alertas genéricas. Esto confunde “sin datos” con “servicio caído”.
6. **Búsqueda costosa y sensible.** Cada cambio de texto a partir de dos caracteres descarga la lista completa, sin debounce ni cancelación del request. Filtra solo por nombre, aunque el placeholder ofrece nombre o ID. Esto escala mal y expone más datos personales de los necesarios al navegador.
7. **Configuración incompleta en CI.** `.env` está correctamente ignorado, pero no existe `.env.example` y el workflow de GitHub Pages no inyecta variables. Salvo configuración externa no visible, el build de CI desplegará URLs indefinidas. Además, el mensaje de error de pagos menciona `VITE_N8N_WEBHOOK_PAGOS`, pero el código lee `..._PAGAR`.
8. **Acoplamiento al detalle de almacenamiento.** El frontend conoce `sheet`, nombres de hojas y `row_number`. Si la fuente externa deja de ser una hoja, gran parte de la UI cambia.
9. **No hay validación de esquema.** Una respuesta HTTP válida pero con forma distinta puede generar estados vacíos o fallos tardíos.

### Centralización recomendada

Sin modificar workflows, crear una capa interna con esta separación:

```text
src/config/env.js                  valida variables al arrancar
src/services/httpClient.js        timeout, headers, parseo y error común
src/services/workflows/
├── elementsWorkflow.js           buscar, inscribir, actualizar, documentos
├── paymentsWorkflow.js           registrar, leer, actualizar, eliminar
├── attendanceWorkflow.js         registrar, leer, actualizar, eliminar
└── dashboardWorkflow.js          resumen
src/services/workflows/adapters/  traduce el modelo de UI al contrato actual
```

Los adaptadores permiten conservar exactamente los payloads que hoy esperan los workflows y normalizar hacia la app una respuesta común, por ejemplo `{ ok, data, message, code }`. Esta propuesta no exige ni presupone cambiar n8n.

## 6. Estado de los módulos principales

Los porcentajes son una estimación técnica del recorrido visible en este repositorio, no una medición de requisitos de negocio aprobados.

### Inscripciones — avance estimado: 65–75 %

**Existe:** formulario de tres pasos; datos personales/tutor; validación básica de fecha y teléfono; selección de seis documentos PDF; envío multipart; estados de carga; manejo de elemento existente; búsqueda y edición posterior de ciertos campos/documentos desde el panel.

**Parece faltar o requiere decisión:** reglas completas de campos y edades; obligatoriedad real de documentos; límites de tamaño; validación de MIME/contenido; progreso de carga; reanudación; consentimiento/aviso de privacidad; edición de sexo/grupo y posiblemente otros datos; confirmación persistente o folio; prueba de duplicados más allá del workflow.

**Dependencias:** webhook de inscripción, webhook de búsqueda, webhook de documentos/campos y panel administrativo. No usa Firebase Storage.

**Riesgos:** los botones “Siguiente” no disparan validación HTML de los pasos ocultos, por lo que se puede llegar al final con pasos previos incompletos; `accept="application/pdf"` no es validación de seguridad; no hay límite de archivo; se transmiten documentos personales desde el navegador a un endpoint cuya autorización no se observa; la fecha máxima usa UTC (`toISOString`) y puede diferir del día local en México; nombres de campos no coinciden entre alta y edición; el upload administrativo ni siquiera limita `accept`.

**Refactor inicial:** extraer esquema/modelo del formulario y adaptador multipart, validar cada paso antes de avanzar, centralizar uploads y definir estados de error recuperable.

### Pagos / mensualidades — avance estimado: 65–75 %

**Existe:** búsqueda de elemento; selección de meses del año actual; cálculo fijo de $200 por mes; selección efectivo/transferencia; alta de pago; visualización de 12 meses; edición y eliminación de registros existentes; confirmaciones y estados básicos por fila.

**Parece faltar o requiere decisión:** consultar meses ya pagados antes del alta; impedir duplicados; años anteriores/siguientes; tarifas configurables, becas/recargos/descuentos; folio/comprobante; conciliación; historial completo; reversión/auditoría en lugar de borrado; permisos por rol.

**Dependencias:** búsqueda completa de elementos, webhook `PAGAR`, webhook administrativo y campos específicos de hojas.

**Riesgos:** importe y meses se calculan/construyen en el cliente y pueden ser manipulados; se ofrecen los 12 meses aunque ya estén pagados; la tarifa está hardcodeada; solo se maneja el año local actual; el alta espera `exito` mientras el CRUD espera `success`; cantidad editada queda como string y no tiene mínimo; la ruta de alta y el panel son públicos en el router; borrar pierde trazabilidad si el backend no conserva auditoría.

**Refactor inicial:** unificar modelo y servicio de pagos, cargar estado de cuenta antes de cobrar, mover reglas configurables fuera del componente y separar “registrar/revertir” de detalles de hoja.

### Asistencias — avance estimado: 60–70 %

**Existe:** captura manual por ID; captura QR con cámara trasera y fallback; listado de resultados del escáner; historial administrativo; cambio de estado (asistencia, falta, retardo, justificada); eliminación.

**Parece faltar o requiere decisión:** fecha/tipo de actividad explícitos; prevención de doble registro; ventana horaria; modo sin conexión; cola/reintentos; selección de evento; justificación documental; filtros/reportes; permisos; feedback con datos del elemento para confirmar identidad.

**Dependencias:** webhook de asistencia, `html5-qrcode`, permisos de cámara/HTTPS y webhook administrativo.

**Riesgos:** la ruta del escáner es pública; el QR se acepta como ID sin validar formato; no hay bloqueo robusto frente a callbacks duplicados ni clave idempotente; un fallo de red puede producir reintentos ambiguos; no se valida el cuerpo de éxito; el callback de error registra continuamente intentos fallidos en consola; la tabla administrativa no es responsiva y puede desbordarse en móvil; las fechas se parsean manualmente y los valores inválidos ordenan de forma impredecible.

**Refactor inicial:** consolidar registro manual/QR en un solo servicio y estado de envío, incorporar deduplicación local/idempotency key acordada como contrato, y rediseñar el historial como cards o tabla con scroll para móvil.

### Módulos auxiliares

- **Home/dashboard:** consume resumen, alertas y actividad; tiene fallback útil. No expone al usuario el error ni opción de reintento.
- **Estadísticas:** página no implementada; solo muestra “PAGINA EN DESARROLLO”.
- **Panel administrativo:** CRUD apreciable, pero sin rol admin observable, con ruta pública, lógica duplicada y borrados sensibles.

## 7. Login futuro passwordless OTP

### Código afectado

- `Login.jsx`: pasaría de correo/contraseña a dos estados visibles, solicitud de código y verificación; necesitará cooldown, reenvío, expiración y feedback no enumerativo.
- `AuthContext.jsx`: deberá dejar de estar acoplado a `signInWithEmailAndPassword` y representar una sesión de aplicación, no necesariamente un `FirebaseUser`.
- `firebase.js`: podría conservarse si la sesión final sigue siendo Firebase (por ejemplo, mediante token personalizado) o retirarse de Auth si se adopta una sesión externa. Esa decisión aún no está definida.
- `RequireAuth.jsx`: debería depender de una interfaz neutral (`status`, `session`, `permissions`) y no de la forma de Firebase.
- `App.jsx`: debe agrupar todas las rutas privadas bajo un solo guard y aplicar autorización por rol/capacidad al panel y operaciones destructivas.
- Todos los servicios de workflows: deberán adjuntar la credencial resultante y manejar 401/403/expiración de forma uniforme.
- UI global: deberá ofrecer cerrar sesión y, si aplica, renovación o reautenticación.

### Contrato mínimo que necesitaría la app

El siguiente es un contrato frontend mínimo a acordar; no prescribe cómo implementarlo dentro de n8n:

1. **Solicitar OTP**: correo normalizado; respuesta genérica con `challengeId`, tiempo de expiración y espera para reenvío. La respuesta no debe revelar si el correo existe.
2. **Verificar OTP**: `challengeId` + código; respuesta exitosa con una sesión verificable, identidad mínima (`userId`, correo) y permisos/rol, además de expiración.
3. **Autenticar operaciones posteriores**: mecanismo explícito para que cada webhook protegido reciba y valide la sesión (por ejemplo un bearer token de vida corta o una cookie segura bajo una arquitectura compatible). Un booleano en `localStorage` no es autenticación.
4. **Expiración/cierre**: contrato para sesión expirada y, según el diseño, renovación y revocación/logout.
5. **Errores estables**: códigos distinguibles para challenge inválido/expirado, OTP inválido, rate limit y sesión no autorizada, sin filtrar información sensible.

### Riesgos específicos de OTP

- Enumeración de usuarios mediante mensajes o tiempos distintos.
- Fuerza bruta sin límites por correo, challenge, IP/dispositivo y ventana temporal.
- Reutilización de OTP o challenge; deben ser de un solo uso y expirar pronto.
- Guardar tokens largos en `localStorage` los expone a XSS. La estrategia de almacenamiento debe decidirse junto con dominio, CORS y modelo de sesión.
- Considerar “correo enviado” como sesión sería una vulnerabilidad crítica: la sesión solo nace tras verificación server-side.
- Migrar el login sin hacer que los webhooks validen la sesión solo cambia la pantalla, no mejora la autorización.

La opción de menor impacto en componentes es introducir primero un `AuthProvider` agnóstico con un adaptador de Firebase actual. Después, el adaptador podrá cambiar al contrato OTP sin reescribir guards y pantallas de negocio.

## 8. UI/UX, estilos y responsividad

### Fortalezas

- Paleta visual consistente (azul oscuro, amarillo, blanco) y componentes generalmente pensados para ancho móvil.
- Formularios con anchos máximos y botones táctiles grandes.
- Bottom navigation clara para las cuatro rutas principales protegidas.
- Feedback de carga en inscripción, panel, pagos y dashboard, aunque no de forma uniforme.

### Problemas

- Los CSS importados son globales aunque estén separados por archivo. Hay 1,447 líneas de CSS y clases reutilizadas accidentalmente (`.form-group`, `.file-name`, `.pago-btns`, `.btn-guardar`, `.btn-eliminar`, `.modal-overlay`), por lo que el orden del bundle puede cambiar estilos entre módulos.
- `global.css` acumula login, layout, scanner e inscripción (391 líneas), mientras `App.css` e `index.css` están vacíos.
- Hay estilos inline extensos, especialmente en `ModuloAsistencias`, que impiden reutilizar tokens y media queries.
- El panel cambia cuatro botones a fila desde 480 px, pero cada botón conserva `width: 32%`; cuatro botones más gaps pueden desbordarse.
- La tabla de asistencias no tiene contenedor con scroll ni variante móvil. El encabezado gris claro puede heredar texto blanco y perder contraste.
- Las rutas de pago, escáner y panel quedan fuera de `Layout`, así que pierden navegación y espaciado de la barra inferior.
- Hay un `<button>` dentro de un `<Link>` en asistencia, patrón HTML interactivo inválido.
- Resultados de búsqueda y flechas de expansión son `li/div` clicables sin semántica de botón ni soporte claro de teclado.
- Modales propios no declaran `role="dialog"`, no gestionan foco/Escape y no restauran foco.
- Faltan labels visibles/asociados en varios inputs, estados `aria-live`, nombres accesibles para iconos y estilos consistentes de foco.
- `index.html` conserva `lang="en"`, título “Vite + React” y favicon de Vite.
- Se declara Roboto pero no se carga; el navegador usará el fallback.

### Recomendación

Mantener CSS, sin introducir de inmediato un framework nuevo. Primero definir tokens CSS (`--color-*`, espacios, radios, sombras), un pequeño conjunto de componentes reutilizables (`Button`, `Field`, `Alert`, `Modal`, `Card`, `PageShell`) y migrar estilos de feature a CSS Modules o una convención encapsulada. Esto reduce riesgo y evita una reescritura visual. Tailwind figura en dependencias pero no está configurado en Vite ni usado; no conviene mantener dos estrategias potenciales.

Para campo móvil, probar explícitamente 320/360/390 px, cámara en Android/iOS, teclado abierto, mala red y textos largos. La posible operación offline merece una decisión de producto antes de implementarse.

## 9. Calidad técnica y bugs potenciales

### Estados, errores y red

- No existe cliente HTTP común, timeout, `AbortController`, reintento controlado ni error normalizado.
- Solo `Buscador` intenta ignorar una respuesta obsoleta, pero no cancela la descarga; además consulta en cada pulsación sin debounce.
- Inscripción y pago deshabilitan el submit; asistencia manual no, por lo que permite dobles envíos.
- Los timers de mensajes no se limpian al desmontar.
- No hay error boundary ni telemetría/registro estructurado.
- Los errores técnicos se imprimen directamente en consola; al usuario se le muestran mensajes genéricos o ningún error.

### Validación y datos

- No hay esquema compartido ni validación runtime de respuestas.
- Los formularios dependen de `required` y validaciones ad hoc; los pasos de inscripción evitan validación al avanzar.
- Archivos sin límite de tamaño y validación únicamente del selector del navegador.
- Reglas monetarias, tarifa, año y meses están en el frontend.
- No se normalizan IDs, nombres, espacios, teléfono o fechas de forma consistente.
- No hay prevención visible de concurrencia: dos operadores pueden editar/borrar el mismo registro basándose en `row_number`.

### Bugs o defectos concretos

- Rutas sensibles sin guard: `App.jsx` líneas 60–65.
- El guard protege navegación, no autoriza webhooks; no se adjunta token.
- `PanelAdmin.handleOperacion` está muerto y sus props se ignoran.
- El buscador promete ID pero filtra solo nombre y descarga todos los elementos.
- `RegistrarPago` lee `VITE_N8N_WEBHOOK_PAGAR` y el error menciona `...PAGOS`.
- Alta de pagos acepta meses ya pagados y confía en importe manipulable.
- `setPersistence` no se espera/captura; imports duplicados e inutilizados en `firebase.js`.
- El flag `isLoggedIn` es escrito/borrado pero nunca consultado.
- No existe UI para logout.
- Las rutas directas `/Modulo*` no proporcionan `data`.
- La carga de documentos administrativos no comprueba que exista la URL antes de construir/enviar la petición.
- `ModuloInfo` no actualiza el objeto padre tras editar un campo; al cambiar/recargar módulo puede reaparecer el dato anterior hasta una nueva lectura.
- `ModuloPagos.cerrarDialogo()` se llama mientras `savingRow`/`deletingRow` aún tiene valor, por lo que su guard puede impedir cerrar el modal después de éxito. El `finally` libera la fila, pero no vuelve a cerrar el diálogo.
- En `ModuloAsistencias`, una edición local fallida no revierte el estado mostrado al valor original.
- El build no tiene code splitting; scanner, Firebase, SweetAlert y módulos admin entran en el bundle inicial.

### Lint, dependencias, documentación y CI

`npm run lint` reporta:

- 5 errores: variable no usada en `Buscador`, regla Fast Refresh en `AuthContext`, dos imports no usados en `firebase.js`, índice no usado en `RegistrarPago`.
- 2 advertencias: dependencias faltantes de hooks en `ModuloPagos` y `Scanner`.

Dependencias aparentemente no usadas: `react-hook-form`, `react-hot-toast`, `react-qr-barcode-scanner`, Tailwind y su plugin, PostCSS/autoprefixer. `React` se importa innecesariamente en `RegistrarPago` con el transform moderno. Deben confirmarse y retirarse solo en una tarea separada.

El README sigue siendo el template de Vite y no documenta producto, instalación, variables, contratos, despliegue ni decisiones. No hay `.env.example`. El workflow usa `npm install` en lugar de instalación reproducible con lockfile, no ejecuta lint/tests y no muestra inyección de variables. Tampoco hay pruebas unitarias, de componentes, de contrato ni end-to-end.

## 10. Puntos débiles principales

1. Autenticación parcial y ausencia observable de autorización de webhooks.
2. Rutas administrativas y operativas públicas.
3. Contratos externos inconsistentes, repetidos y sin validación.
4. Reglas sensibles de pagos y deduplicación confiadas al cliente.
5. Exposición/descarga excesiva de datos mediante búsqueda completa.
6. Manejo de red insuficiente para operación en campo.
7. CSS global con colisiones y accesibilidad incompleta.
8. Sin pruebas, lint rojo y CI de solo despliegue.
9. Configuración de entorno/deploy no documentada ni validada.
10. Modelo frontend acoplado a hojas y `row_number`.

## 11. Riesgos críticos

| Prioridad | Riesgo | Impacto | Acción de diagnóstico/mitigación inmediata |
|---|---|---|---|
| Crítica | CRUD y rutas sensibles accesibles sin guard; webhooks sin credencial observable | Lectura, modificación o borrado no autorizado de datos personales, pagos y asistencias | Proteger todas las rutas y, sobre todo, confirmar/documentar cómo cada endpoint valida identidad y rol. El guard solo no basta. |
| Crítica | URLs Vite tratadas implícitamente como protección | Invocación directa de endpoints publicados en el bundle | Clasificarlas como públicas; no almacenar secretos en ellas; acordar autenticación de requests. |
| Alta | Datos personales/documentos enviados sin controles frontend completos | Privacidad, archivos maliciosos, cargas excesivas | Acordar límites y formatos; validar cliente y receptor; documentar retención y acceso. |
| Alta | Pagos calculados en cliente y duplicables | Inconsistencia financiera | Definir fuente autoritativa de tarifa/estado, idempotencia y auditoría; nunca confiar solo en el payload del navegador. |
| Alta | Borrado por `row_number` y sin control de concurrencia visible | Borrado de fila equivocada o pérdida de trazabilidad | Confirmar identificadores estables, auditoría y política de reversión. |
| Alta | OTP futuro sin sesión verificable para workflows | Sensación de seguridad sin autorización real | Resolver contrato de sesión antes de cambiar la pantalla de login. |
| Media | CI puede desplegar endpoints indefinidos | Producción parcialmente rota | Añadir validación de entorno e inyección segura/documentada en build. |
| Media | Sin timeout/idempotencia/offline | Duplicados o bloqueo operativo con mala señal | Cliente HTTP común, estados recuperables y definición de reintento. |

## 12. Recomendaciones de refactorización priorizadas

### P0 — frontera de seguridad y contrato

1. Inventariar propietarios, autenticación, CORS, rate limits y autorización real de cada webhook, sin cambiarlo todavía.
2. Reorganizar `App.jsx` para que toda ruta operativa requiera sesión y el panel requiera permiso administrativo; eliminar rutas directas de módulos solo después de confirmar que no son enlaces públicos intencionales.
3. Diseñar sesión/roles agnósticos de Firebase y decidir cómo se acredita cada request. Esto prepara OTP y cierra el hueco conceptual actual.
4. Declarar las variables `VITE_*` como configuración pública y rotar cualquier URL que hoy se esté usando como secreto, si el dueño confirma ese uso.

### P1 — capa de workflows sin cambiar n8n

1. Crear config validada y cliente HTTP con timeout, parseo, errores y auth centralizados.
2. Crear adaptadores por módulo que conserven los payloads actuales y devuelvan un resultado uniforme.
3. Definir contratos en código (TypeScript o validación runtime) y fixtures de respuesta para `success`, `exito`, wrappers n8n y errores.
4. Agregar idempotency/correlation ID al contrato futuro donde el receptor lo soporte; mientras tanto, bloquear doble submit y representar estado incierto.

### P2 — separar features y reglas

1. Agrupar por `features/inscripciones`, `features/pagos`, `features/asistencias`, dejando páginas delgadas.
2. Extraer esquemas de formulario y validar por paso.
3. Separar cálculo/presentación de pagos de transporte; obtener/validar meses pagados antes del alta.
4. Unificar registro de asistencia manual y QR sobre el mismo caso de uso.
5. Sustituir dependencia de `row_number` en el modelo de UI por un ID de registro; un adaptador puede seguir traduciendo al contrato actual.

### P3 — UI y calidad

1. Crear tokens y componentes base; encapsular CSS por feature.
2. Corregir accesibilidad y layouts móviles de panel/tablas/modales.
3. Añadir pruebas de servicios/adaptadores, formularios y rutas; luego E2E de los tres recorridos críticos con webhooks simulados.
4. Dejar lint y build como gates de CI, usar instalación reproducible y documentar despliegue/env.
5. Lazy-load de scanner/admin y retirar dependencias muertas confirmadas.

## 13. Primeras 3 tareas recomendadas

### 1. Cerrar y documentar la frontera de acceso

Crear una matriz ruta → rol → operación → webhook → credencial requerida. Proteger en React todas las rutas operativas y administrativas, añadir logout y confirmar con el dueño cómo se valida hoy cada webhook. Resultado esperado: se conoce con precisión qué es seguridad UI y qué es autorización real.

### 2. Introducir la capa de integración y contratos actuales

Crear `config/env`, `httpClient` y servicios/adaptadores por módulo, sin cambiar payloads externos. Añadir timeout, normalización de `success/exito`, errores tipados y pruebas con respuestas capturadas/sanitizadas. Resultado esperado: n8n queda aislado de los componentes y cualquier futura migración —incluido OTP— tiene un solo punto de integración.

### 3. Endurecer un recorrido vertical: pagos

Usar la nueva capa en búsqueda + registro + administración de pagos; bloquear dobles envíos, diferenciar error/sin resultados, validar cantidad/meses y resolver el modal que no cierra. Se recomienda pagos primero por su sensibilidad financiera y porque concentra casi todos los patrones que después se replicarán en inscripciones y asistencias.

## 14. Decisiones y preguntas pendientes para el dueño

### Seguridad e identidad

1. ¿Quién puede inscribir, cobrar, registrar asistencias, editar y borrar? ¿Existen roles distintos (administrador, caja, instructor, consulta)?
2. ¿Los webhooks validan hoy alguna credencial, allowlist, firma o token fuera de este repo? ¿Cómo distinguen al operador que hizo el cambio?
3. ¿Debe el panel administrativo estar disponible para todos los usuarios autenticados?
4. Para OTP, ¿se desea mantener Firebase como emisor de la sesión final o reemplazar Firebase Auth por una sesión propia/orquestada externamente?
5. ¿En qué dominio se desplegará producción? Esta respuesta afecta cookies, CORS, Firebase Authorized Domains y estrategia de sesión.

### Datos y workflows

6. ¿Cuál es la especificación real y versionada de cada payload/respuesta? ¿Se pueden proporcionar ejemplos anonimizados de éxito/error?
7. ¿Dónde viven actualmente los datos: Google Sheets, base de datos, Drive u otra fuente? El frontend sugiere hojas, pero no debe darse por hecho.
8. ¿Qué significa borrar un elemento? ¿Debe borrar/cancelar también pagos, asistencias y documentos? ¿Existe auditoría o recuperación?
9. ¿Cuál es el identificador estable de pagos/asistencias? ¿`row_number` puede cambiar por inserciones, filtros o reordenamiento?
10. ¿Qué límites de tamaño, tipo, retención y permisos aplican a documentos personales?

### Reglas de producto

11. ¿La mensualidad siempre es $200? ¿Hay tarifas por grupo, año, becas, descuentos, recargos o pagos parciales?
12. ¿Se permite pagar meses futuros, meses repetidos o años anteriores? ¿Cómo se corrige un cobro sin perder auditoría?
13. ¿Qué evita una asistencia duplicada? ¿La fecha/tipo/evento los determina el workflow? ¿Hay tolerancia de retardo?
14. ¿La app debe funcionar con conectividad intermitente o sin conexión durante actividades de campo?
15. ¿Todos los documentos de inscripción son opcionales? ¿Qué edad/grupos/sexos y reglas médicas deben validarse?

### Operación y entrega

16. ¿El despliegue real es GitHub Pages y dónde se inyectan actualmente las siete variables `VITE_*`?
17. ¿Hay ambientes separados de desarrollo/pruebas/producción y endpoints de prueba que no modifiquen datos reales?
18. ¿Qué métricas, logs o trazabilidad necesita el responsable para investigar un pago/asistencia fallidos?
19. ¿La página `Estadisticas` y el dashboard son el mismo alcance o productos distintos?
20. ¿Qué navegadores/dispositivos Android/iOS deben soportarse y qué volumen esperado hay de elementos, pagos y asistencias?

## 15. Criterio de salida sugerido para la siguiente etapa

Antes de una refactorización amplia, deberían quedar resueltas tres cosas: matriz de permisos/sesión, contratos anonimizados de webhooks y reglas autoritativas de pagos/asistencias. Con eso se puede refactorizar por recorridos verticales sin inventar comportamiento externo ni romper procesos ya operativos.

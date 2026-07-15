# Autenticación Supabase passwordless OTP

Fecha: 28 de junio de 2026  
Alcance: autenticación de operadores únicamente. No incluye base de datos de negocio ni cambios en n8n.

## Estado implementado en React y hook habilitado

PDMU APP usa `@supabase/supabase-js` directamente desde React/Vite para:

- Solicitar un OTP por correo con `signInWithOtp`.
- Verificar el código con `verifyOtp` y `type: "email"`.
- Restaurar y observar la sesión con `getSession` y `onAuthStateChange`.
- Renovar el access token mediante `refreshSession` cuando se solicita explícitamente.
- Cerrar únicamente la sesión actual con `signOut({ scope: "local" })`.

No se usa Next.js, `@supabase/ssr`, middleware, App Router ni `/rest/v1/`. El cliente no consulta tablas de Supabase.

Supabase Auth es la autoridad OTP: genera el código, verifica el código y emite la sesión. React solo solicita y verifica. El Send Email Hook HTTPS está reportado como habilitado hacia n8n; React no genera el OTP, no envía correo y no conoce ni llama al webhook de entrega.

## Variables de entorno

Crear `.env.local` —ignorado por Git— con:

```dotenv
VITE_SUPABASE_URL=<project-url>
VITE_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...>
```

`.env.example` contiene los nombres vacíos y puede versionarse. `src/config/supabaseEnv.js` valida:

- Presencia de ambas variables.
- URL HTTPS válida.
- Formato `sb_publishable_` de la clave.

Las variables `VITE_*` son visibles en el bundle del navegador. La publishable key está diseñada para ese contexto, pero una secret key o service-role key **nunca** debe colocarse en React, `.env.example`, documentación, commits o logs.

## Configuración necesaria en Supabase Dashboard

El código por sí solo no puede cambiar la configuración del proyecto. Antes de probar el login:

1. Habilitar el proveedor Email en Authentication.
2. Crear/preautorizar a los operadores en Supabase Auth. La app usa `shouldCreateUser: false`, por lo que solicitar OTP no registra usuarios nuevos.
3. Revisar expiración del OTP, intervalo de reenvío, Site URL y rate limits.
4. Mantener habilitado el Send Email Hook descrito más adelante para que n8n realice la entrega.

El mailer estándar de Supabase solo es aceptable como contingencia o prueba temporal con el hook deshabilitado; no es el flujo final de PDMU APP. En esa prueba aislada, la plantilla “Magic Link / OTP” debe incluir `{{ .Token }}` para mostrar el código en vez de `{{ .ConfirmationURL }}`. Con el hook habilitado, la entrega corresponde a n8n.

Los usuarios existentes en Firebase **no fueron migrados**. Hasta que un operador exista en Supabase Auth no podrá completar el nuevo login.

## Flujo de la pantalla

### Paso 1: correo

1. El usuario captura su correo.
2. `AuthContext.requestOtp(email)` normaliza trim/lowercase.
3. Supabase recibe `signInWithOtp` con `shouldCreateUser: false`.
4. La UI siempre muestra: “Si el correo está autorizado, recibirás un código.”

La pantalla no informa si el correo existe. Supabase sigue aplicando sus límites y respuestas en la petición de red.

### Paso 2: código

1. El usuario captura el código numérico enviado; la UI acepta entre 6 y 8 dígitos.
2. `AuthContext.verifyOtp(email, token)` llama a Supabase Auth.
3. Si la verificación crea una sesión, se normaliza y el usuario vuelve a la ruta solicitada o `/home`.
4. Si falla, la UI muestra que el código es inválido o expiró.

La pantalla ofrece reenvío con cooldown local de 60 segundos y cambio de correo. El límite local mejora UX; Supabase conserva el rate limit autoritativo.

Antes de verificar, React elimina espacios, guiones y cualquier carácter no numérico. No se asume una longitud fija de seis dígitos: la configuración actual de Supabase puede entregar tokens de ocho.

## Sesión neutral

Supabase se adapta al contrato existente:

```js
{
  uid,
  email,
  displayName,
  provider: "supabase-otp"
}
```

`AuthContext` continúa exponiendo:

```js
{
  authStatus, // loading | authenticated | unauthenticated
  session,
  requestOtp(email),
  verifyOtp(email, token),
  logout(),
  getAccessToken(forceRefresh)
}
```

`RequireAuth`, `AuthenticatedShell` y las rutas privadas no dependen de Firebase ni de la forma interna de la sesión Supabase.

## Qué cambió respecto a Firebase

- `AuthContext` dejó de importar el adaptador Firebase.
- Se eliminó el consumidor `login(email, password)` y se reemplazó por solicitud/verificación OTP.
- Supabase gestiona persistencia, refresh y eventos de sesión en el navegador.
- El logout visible sigue usando la interfaz neutral.

Se conservaron temporalmente:

- `src/services/auth/firebaseAuth.js`.
- `src/firebase.js`.
- La dependencia `firebase`.

Ya no participan en el login normal. Pueden retirarse en una tarea posterior, después de probar el acceso OTP y confirmar que ningún despliegue necesita rollback inmediato. Esta fase no mezcla la migración con limpieza amplia de dependencias.

## Qué sigue usando n8n

Sin cambios:

- Búsqueda e inscripciones.
- Pagos y mensualidades.
- Asistencias manuales y QR.
- Panel administrativo.
- Documentos y dashboard.

Los payloads, URLs y normalizadores de `src/services/workflows` no se modificaron. Tampoco se adjunta todavía el access token Supabase a esos webhooks.

## Qué no se migró

- Datos de elementos, tutores o documentos.
- Pagos o mensualidades.
- Asistencias.
- Sheets o n8n Tables.
- Usuarios Firebase existentes.
- Roles/permisos de negocio.
- Autorización server-side de webhooks.
- Prueba end-to-end y verificación operativa de la entrega OTP por n8n.

## Flujo final de entrega mediante n8n

El flujo requerido es:

```text
React requestOtp(email)
  → Supabase Auth genera el OTP
  → Supabase Send Email Hook
  → https://n8n.scolaris.com.mx/webhook/pdmu-otp
  → n8n envía el correo
  → React verifyOtp(email, token)
  → Supabase Auth valida y emite sesión
```

El endpoint de entrega definido es:

```text
https://n8n.scolaris.com.mx/webhook/pdmu-otp
```

Esta URL se configura en Supabase Auth Hooks o, si n8n no puede validar/consumir el hook de forma segura, en un adaptador backend que reciba el hook y lo reenvíe. **No debe aparecer en código React, `VITE_*`, `.env.local` del frontend ni servicios de workflows del navegador.**

El Send Email Hook reemplaza el envío incorporado de Supabase. Cuando el hook está habilitado y el proveedor Email continúa habilitado, el hook maneja la entrega y SMTP no envía ese mensaje.

### Configuración reportada y comprobaciones pendientes

El dueño reporta completados los pasos de Dashboard: **Authentication → Auth Hooks → Send Email Hook HTTPS** apuntando a `https://n8n.scolaris.com.mx/webhook/pdmu-otp`.

Todavía debe comprobarse operativamente:

1. Que el secreto/firma del hook esté activo y n8n lo valide.
2. Que una ejecución real entregue los headers de Standard Webhooks y el payload esperado.
3. Que el payload incluya el correo destino y el OTP/token para login.
4. Que n8n conteste HTTP 200 después de aceptar/enviar correctamente el correo. La documentación oficial indica que una respuesta vacía con status 200 se considera exitosa.
5. Que solicitud, reenvío, expiración, código incorrecto y login correcto funcionen con un operador preautorizado.

Supabase firma los HTTP Auth Hooks con un secreto generado en Dashboard. n8n debe validar la firma y evitar replay conforme al mecanismo real de Standard Webhooks. Si n8n no puede hacerlo directamente, se requiere un adaptador server-side que valide la firma antes de invocar el workflow. La URL por sí sola no es protección.

### Payload real que debe aceptar n8n

No se define un payload inventado entre React y n8n: React nunca participa en esta llamada. n8n debe aceptar el payload que Supabase Send Email Hook envíe realmente.

Según el esquema oficial vigente, el cuerpo tiene dos objetos principales:

```json
{
  "user": {
    "email": "destino@ejemplo.mx"
  },
  "email_data": {
    "token": "123456",
    "token_hash": "...",
    "redirect_to": "...",
    "email_action_type": "...",
    "site_url": "...",
    "token_new": "",
    "token_hash_new": ""
  }
}
```

El ejemplo es una forma reducida del esquema oficial, no un contrato transformado propio. Antes de cerrar el workflow se debe capturar una petición real del proyecto y validar nombres, presencia y semántica. Como mínimo, n8n necesita extraer:

- Correo destino: normalmente `user.email`.
- OTP de entrega: normalmente `email_data.token` para este flujo.
- Tipo de acción: `email_data.email_action_type`, cuyo valor exacto debe comprobarse con un login real y no asumirse como `login`.
- Datos mínimos de plantilla, por ejemplo identidad visual, propósito y expiración configurada.

Para acciones distintas a login —cambio de correo, recovery u otras— pueden existir `token_new`, hashes o reglas de destinatario diferentes. El workflow `pdmu-otp` debe aceptar únicamente las acciones aprobadas o ramificarlas explícitamente; no debe reutilizar a ciegas el mismo campo para todos los casos.

### Pendientes en n8n

- Recibir el HTTP hook real y validar su firma/secreto.
- Extraer los campos confirmados en una ejecución de prueba.
- Rechazar acciones no soportadas.
- Construir la plantilla sin registrar permanentemente OTP/token.
- Enviar mediante el proveedor configurado por el dueño.
- Responder 200 solo cuando la entrega haya sido aceptada correctamente.
- Definir timeout, reintentos, observabilidad y redacción de execution logs.

Requisitos de seguridad antes de activarlo:

- URL y secreto solo en configuración server-side; la URL no es una variable frontend.
- Verificación del mecanismo de firma del hook.
- n8n no debe persistir el OTP en execution logs.
- Respuesta no enumerativa.
- Rate limiting y observabilidad.

No se creó ni modificó ningún workflow n8n desde este repositorio. El hook figura como configurado por el dueño; la entrega real, validación de firma y respuesta del workflow deben comprobarse con una cuenta de prueba autorizada.

## Archivos principales

- `src/config/supabaseEnv.js`: configuración pública validada.
- `src/services/auth/supabaseClient.js`: cliente browser oficial.
- `src/services/auth/supabaseAuth.js`: adaptador OTP/sesión.
- `src/contexts/AuthContext.jsx`: interfaz neutral conectada a Supabase.
- `src/pages/Login.jsx`: flujo correo → código.
- `.env.example`: nombres de variables sin valores reales.

## Validación local

- `@supabase/supabase-js`: 2.108.2 instalada y registrada en el lockfile.
- `npm run lint`: correcto.
- `npm run build`: correcto.
- El build conserva una advertencia por tamaño del chunk principal; debe abordarse con lazy loading/code splitting en una tarea separada.
- No existen llamadas `supabase.from`, Storage, RPC o Functions para datos de negocio.

## Referencias oficiales

- [Supabase: passwordless email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Supabase JS: signInWithOtp](https://supabase.com/docs/reference/javascript/auth-signinwithotp)
- [Supabase JS: verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp)
- [Supabase JS: onAuthStateChange](https://supabase.com/docs/reference/javascript/auth-onauthstatechange)
- [Supabase: email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase Auth: Send Email Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook)

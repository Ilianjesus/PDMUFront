# Arquitectura

## Responsabilidades

El frontend React presenta la interfaz, conserva la sesión y consume funciones
RPC de Supabase. No contiene credenciales privilegiadas ni lógica administrativa
que dependa de una `service_role`.

Supabase es la fuente de verdad para autenticación, elementos, inscripciones,
mensualidades, asistencias, documentos y perfiles de operador. Las políticas RLS
y las funciones RPC delimitan todas las operaciones del navegador.

n8n cubre las integraciones que requieren secretos o coordinación externa:

- Entrega del OTP generado por Supabase Auth.
- Creación idempotente de carpetas, QR y PDF en Google Drive.

La gestión de operadores usa la Edge Function `manage-operators`: valida la
sesión y el perfil administrador, crea la cuenta en Supabase Auth y actualiza
`operator_profiles`. No depende de un tercer workflow. El perfil en la base
de datos es la autoridad para el rol y el estado; los metadatos de Auth solo
inicializan el perfil al crear la cuenta.

## Configuración pública

El contrato completo está en `.env.example`. Solo las variables con prefijo
`VITE_` llegan al bundle, por lo que deben contener exclusivamente valores
públicos de cliente y URLs de webhooks protegidos por sesión.

La llamada documental del frontend a n8n incluye el access token actual de
Supabase. El workflow debe validar el token y el rol antes de ejecutar una
acción. También recibe `Idempotency-Key` y `X-Request-Id`. El OTP se
entrega mediante el email hook de Supabase Auth, no mediante una llamada
directa del navegador.

## Documentos

El alta de un elemento guarda primero la operación de negocio en Supabase. Las
capturas se almacenan temporalmente en el bucket privado `element-intake` y se
registra un trabajo idempotente en `element_asset_jobs`. En cuanto ambos pasos
terminan, la interfaz confirma la inscripción y deja el procesamiento en segundo
plano.

El worker autenticado reclama un trabajo a la vez, recupera sus capturas y llama
al workflow documental. Si la sesión o la pestaña se cierran, el trabajo conserva
su estado y se retoma en la siguiente sesión administrativa. Los intentos tienen
lease y espera progresiva para evitar ejecuciones duplicadas. n8n crea la carpeta
bajo la raíz configurada en Drive:

```text
<APELLIDOS NOMBRES>/
|-- Documentos/
`-- Codigo QR/
    `-- <codigo>-qr.png
```

Los errores transitorios no agotan definitivamente el trabajo: queda pendiente
para el siguiente worker autenticado con una espera acotada. La captura temporal
solo se elimina después de confirmar el resultado en Supabase.

Supabase conserva el identificador y URL de la carpeta, el valor QR y las
referencias de los documentos. `complete_element_assets` registra el resultado y
marca el trabajo como completo dentro de la misma transacción. Después se eliminan
las capturas temporales. Las fotografías originales se convierten a PDF antes de
registrarse como completas.

## Despliegue

GitHub Pages usa `VITE_BASE_PATH=/PDMUFront/`. El contenedor NGINX usa `/` y
resuelve rutas de la SPA mediante `try_files`. Las variables se inyectan durante
el build porque Vite genera archivos estáticos.

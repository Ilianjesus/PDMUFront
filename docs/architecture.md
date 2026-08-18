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
- Invitación y actualización de operadores.
- Creación idempotente de carpetas, QR y PDF en Google Drive.
- Resúmenes operativos y manejo central de errores.

## Configuración pública

El contrato completo está en `.env.example`. Solo las variables con prefijo
`VITE_` llegan al bundle, por lo que deben contener exclusivamente valores
públicos de cliente y URLs de webhooks protegidos por sesión.

Las llamadas del frontend a n8n incluyen el access token actual de Supabase. El
workflow debe validar el token y el rol antes de ejecutar una acción. La creación
documental también envía `Idempotency-Key` y `X-Request-Id`.

## Documentos

El alta de un elemento guarda primero la operación de negocio en Supabase. La
automatización documental se ejecuta después y puede reintentarse sin duplicar
archivos. n8n crea la carpeta bajo la raíz configurada en Drive:

```text
<APELLIDOS NOMBRES>/
|-- Documentos/
`-- Codigo QR/
    `-- <codigo>-qr.png
```

Supabase conserva el identificador y URL de la carpeta, el valor QR y las
referencias de los documentos. Las fotografías originales se convierten a PDF
antes de registrarse como completas.

## Despliegue

GitHub Pages usa `VITE_BASE_PATH=/PDMUFront/`. El contenedor NGINX usa `/` y
resuelve rutas de la SPA mediante `try_files`. Las variables se inyectan durante
el build porque Vite genera archivos estáticos.

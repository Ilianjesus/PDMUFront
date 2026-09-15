# PDMU Digital

Versión estable **1.0.0** de la aplicación administrativa mobile-first para
gestionar elementos, inscripciones, asistencia por QR, expedientes documentales,
control de pagos y operadores del PDMU. La aplicación registra pagos recibidos;
no procesa cobros ni funciona como pasarela de pago.

Producción: [ilianjesus.github.io/PDMUFront](https://ilianjesus.github.io/PDMUFront/)

## Arquitectura

- React 19 y Vite para el cliente web.
- Supabase Auth, PostgreSQL, RPC, RLS y Storage como fuente de verdad.
- Supabase Edge Function para operaciones privilegiadas sobre operadores.
- n8n para entregar OTP y generar QR/PDF y expedientes en Google Drive.
- Vitest, Testing Library, Playwright y PostgreSQL 16 para validación.

El navegador utiliza únicamente la publishable key de Supabase. Las claves
`service_role`, Gmail, Google Drive, conversión PDF y n8n nunca se almacenan en
el repositorio ni se entregan al frontend.

Consulta [Arquitectura](docs/architecture.md) y
[Base de datos](docs/database.md) para conocer los límites de responsabilidad y
el modelo de datos.

## Requisitos

- Node.js 22.
- npm 10 o posterior.
- Docker, únicamente para validar las migraciones localmente.
- Un proyecto Supabase y los dos workflows publicados de n8n.

## Configuración local

```bash
npm ci
cp .env.example .env.local
npm run dev -- --host
```

Completa `.env.local` con los valores de tu entorno. Este archivo está ignorado
por Git. La aplicación queda disponible en
`http://localhost:5173/PDMUFront/` y Vite muestra además la dirección de red.

| Variable | Uso |
| --- | --- |
| `VITE_SUPABASE_URL` | URL pública del proyecto Supabase. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key apta para navegador. |
| `VITE_SUPABASE_DOCUMENTS_BUCKET` | Bucket privado de documentos definitivos. |
| `VITE_SUPABASE_INTAKE_BUCKET` | Bucket privado para capturas temporales. |
| `VITE_N8N_ELEMENTS_ASSETS_URL` | Webhook documental publicado y protegido por sesión. |
| `VITE_BASE_PATH` | `/PDMUFront/` en Pages o `/` en Docker. |

Las variables `VITE_` se incorporan al bundle y por definición son públicas. El
webhook documental debe validar el access token de Supabase que envía la app;
su URL no debe considerarse una credencial. El endpoint real se conserva en
`.env.local` y en GitHub Secrets para evitar fijarlo en el código o el historial.
El workflow OTP se conecta como **Send Email Hook** de Supabase Auth y no se
invoca directamente desde el navegador.

## Base de datos y servicios

En una instalación nueva, aplica en orden todos los archivos de
`supabase/migrations/`. La baseline canónica es
`20260818000100_current_schema.sql`; las migraciones posteriores completan la
cola documental y las RPC de negocio.

Después despliega `supabase/functions/manage-operators` y configura sus secretos
en Supabase. Para el primer administrador utiliza
`supabase/seed/create_first_admin_template.sql` después de reemplazar únicamente
el marcador local; no guardes datos personales en el archivo versionado.

Fuera del repositorio deben configurarse:

1. El Send Email Hook de Supabase Auth apuntando al workflow OTP publicado.
2. El workflow documental de n8n y sus credenciales de Google Drive/PDF.
3. El acceso del workflow a la carpeta raíz operativa de Drive.

## Verificación

```bash
npm run lint
npm test
npm run test:schema
npm run build
npm run test:e2e
```

También puedes ejecutar toda la validación con `npm run test:all`.
`test:schema` levanta PostgreSQL 16 en Docker, aplica la cadena completa en una
base desechable y comprueba sus contratos. `test:e2e` usa Chromium y simula la
frontera HTTP de Supabase.

## Despliegue en GitHub Pages

El repositorio conserva el mecanismo ya configurado en GitHub Pages: la rama
`gh-pages`, carpeta raíz. Cada push a `main` ejecuta
`.github/workflows/deploy.yml`, valida la aplicación, construye `dist/` y publica
únicamente ese resultado en `gh-pages`.

Configura estos secretos en **Settings → Secrets and variables → Actions**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_N8N_ELEMENTS_ASSETS_URL`

Los nombres de buckets y `VITE_BASE_PATH=/PDMUFront/` están definidos en el
workflow. No agregues `.env.local`, endpoints reales ni tokens al repositorio.

## Docker

```bash
docker compose --env-file .env.local up --build
```

La aplicación queda disponible en `http://localhost:8080`. Para este despliegue
utiliza `VITE_BASE_PATH=/` en `.env.local`.

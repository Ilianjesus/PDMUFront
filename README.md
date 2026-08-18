# PDMU Digital

Aplicación mobile-first para administrar elementos, inscripciones, pagos,
asistencias, expedientes documentales y operadores del PDMU.

## Stack

- React 19 y Vite.
- Supabase Auth, Postgres, RPC, RLS y Storage.
- n8n para entrega OTP, administración privilegiada y documentos en Drive.
- Vitest, Testing Library, Playwright y PostgreSQL 16 para validación.

El navegador utiliza únicamente una publishable key de Supabase. Las claves
`service_role`, Gmail, Google Drive y PDF pertenecen a Supabase o n8n y nunca al
frontend.

## Desarrollo

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Completa `.env.local` con los valores públicos de Supabase y las URLs publicadas
de n8n. La app se sirve en `http://localhost:5173/PDMUFront/`.

## Verificación

```bash
npm run lint
npm run test
npm run test:schema
npm run build
npm run test:e2e
```

`test:schema` necesita Docker y valida todas las migraciones en un PostgreSQL 16
desechable. `test:e2e` usa Chromium y simula la frontera HTTP de Supabase.

## Docker

```bash
docker compose --env-file .env.local up --build
```

La aplicación queda disponible en `http://localhost:8080`. Para este despliegue
usa `VITE_BASE_PATH=/` en `.env.local`.

## Despliegue

1. Aplica `supabase/migrations/202608180001_current_schema.sql` en un proyecto nuevo.
2. Publica los workflows de n8n y configura el hook Send Email de Supabase Auth.
3. Configura Gmail, Google Drive y el conversor PDF dentro de n8n.
4. Da acceso a Drive sobre la carpeta raíz operativa.
5. Define los secretos requeridos por `.github/workflows/deploy.yml`.

Consulta [Arquitectura](docs/architecture.md) y
[Base de datos](docs/database.md) para los límites de responsabilidad y la
operación del esquema.

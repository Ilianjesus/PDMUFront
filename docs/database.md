# Base de datos

## Esquema actual

`supabase/migrations/202608180001_current_schema.sql` es la baseline única del
producto. Contiene el estado vigente de tablas, funciones RPC, índices, triggers,
RLS, permisos, Storage y datos estructurales. No conserva pasos intermedios ni
versiones reemplazadas.

La validación local integral ejecuta:

```bash
npm run test:schema
```

El script levanta PostgreSQL 16 en Docker, crea las primitivas mínimas de Auth y
Storage, aplica la baseline y comprueba sincronización de tutor,
idempotencia documental, persistencia de Drive y protección del último admin.

La baseline está destinada a proyectos nuevos. El proyecto Supabase ya desplegado
no necesita volver a ejecutarla porque su esquema ya se encuentra en este estado.

## Primer administrador

1. Crea el usuario mediante Supabase Auth.
2. Reemplaza `REPLACE_ADMIN_EMAIL` en
   `supabase/seed/create_first_admin_template.sql`.
3. Ejecuta el archivo una vez desde el SQL Editor con un rol privilegiado.

El template falla de forma explícita mientras conserve el placeholder y no
contiene UUID, correo ni otros datos de una persona real.

## Seguridad

- El frontend solo recibe `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Las operaciones de usuario están sujetas a RLS.
- Las tareas administrativas externas validan sesión y rol en n8n.
- El bucket `element-documents` es privado.
- Las credenciales de infraestructura no se almacenan en este repositorio.

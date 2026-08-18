# Base de datos

## Migraciones

`supabase/migrations` contiene el historial ejecutable del producto. Los archivos
se aplican por nombre ascendente y no deben editarse después de desplegarse; un
cambio posterior se agrega como una nueva migración.

La validación local integral ejecuta:

```bash
npm run test:schema
```

El script levanta PostgreSQL 16 en Docker, crea las primitivas mínimas de Auth y
Storage, aplica todas las migraciones y comprueba sincronización de tutor,
idempotencia documental, persistencia de Drive y protección del último admin.

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

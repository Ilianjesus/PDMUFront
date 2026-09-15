# Base de datos

## Esquema actual

`supabase/migrations/20260818000100_current_schema.sql` es la baseline para
proyectos nuevos. Los archivos posteriores son la cadena canónica de
migraciones; sus versiones coinciden con el historial del proyecto remoto.
La baseline contiene tablas, funciones RPC, índices, triggers, RLS, permisos,
Storage y datos estructurales. Las migraciones siguientes agregan la cola
documental y reconcilian las diferencias del proyecto existente sin borrar
datos.

La validación local integral ejecuta:

```bash
npm run test:schema
```

El script levanta PostgreSQL 16 en Docker, crea las primitivas mínimas de Auth y
Storage, aplica toda la cadena y comprueba sincronización de tutor,
idempotencia documental, persistencia de Drive y protección del último admin.

La cola `element_asset_jobs` conserva el estado durable del procesamiento de QR,
PDF y Drive. El bucket privado `element-intake` contiene únicamente capturas
temporales mientras el trabajo está pendiente o en proceso.

La baseline no debe volver a ejecutarse en el proyecto ya desplegado: quedó
registrada como aplicada después de reconciliar y comparar su esquema con una
instalación nueva. `grupo` es una categoría de negocio derivada de sexo y edad
al consultar; `group_code` se conserva como dato histórico para no perder
información previa, pero no decide la categoría vigente.

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
- La Edge Function de operadores valida sesión y rol en `operator_profiles`.
- El workflow documental debe validar sesión y rol antes de procesar archivos.
- El bucket `element-documents` es privado.
- Las credenciales de infraestructura no se almacenan en este repositorio.

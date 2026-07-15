# Evidencia de validación Supabase business schema v1

Fecha: 29 de junio de 2026.  
Modo: **B — PostgreSQL local desechable**.

## Alcance ejecutado

El esquema se aplicó a PostgreSQL 16.14 local mediante el backend single-user. No se inició un servidor, no se abrió socket/TCP, no se usó Supabase remoto y no se leyó ninguna credencial.

Orden ejecutado:

1. Stub local mínimo de `auth.users`, `anon`, `authenticated` y `service_role`.
2. `supabase/migrations/202606290001_business_schema_v1.sql`.
3. `supabase/validation/validate_business_schema_v1.sql`.
4. `supabase/seed/seed_business_schema_v1.sql`.
5. `supabase/validation/sanity_checks_business_schema_v1.sql`.
6. Consulta de evidencia de RLS y privilegios.

El clúster fue desechable y quedó detenido bajo `/tmp`; contiene únicamente fixtures ficticios. No se insertó ni eliminó información real.

## Resultado

```text
bootstrap | PASS
migration | PASS
validation | PASS
validation_status | PASS
seed | PASS
seed_status | PASS
sanity | PASS
sanity_status | PASS
security | PASS
local_validation_complete | PASS
```

Antes de aceptar el resultado se inspeccionaron todos los logs y se rechazó cualquier aparición de `ERROR:`, `FATAL:` o `PANIC:`. Esto es necesario porque `postgres --single` puede devolver código 0 después de ciertos errores SQL.

## Seguridad confirmada

- Las siete tablas existen y tienen RLS habilitado.
- No existen policies v1 que habiliten acceso directo.
- `anon` y `authenticated` no tienen privilegios CRUD directos.
- `service_role` no tiene DELETE físico sobre perfiles, elementos, documentos, pagos, asistencias o auditoría.
- `audit_log` no concede UPDATE/DELETE a `service_role` y su trigger rechaza mutaciones.
- `created_at` se asigna server-side y no puede reescribirse en updates probados.
- `version` inicia en 1 e ignora valores del insert; updates de elemento, pago y asistencia incrementan exactamente una vez e ignoran el valor enviado.
- `attendance_date` se deriva de `occurred_at` usando `America/Mexico_City`.
- Pagos activos duplicados por elemento/año/mes son rechazados; un periodo puede registrarse otra vez después de cancelar el anterior.
- Dos documentos activos del mismo tipo/elemento son rechazados; reemplazado + activo sí está permitido.
- Las FKs rechazan hijos sin elemento y borrado de un elemento con dependencias.

## Correcciones realizadas antes del PASS

- Se agregó `enforce_created_at()` para documentos, auditoría e idempotencia.
- Los triggers de elementos, pagos y asistencias ahora fuerzan `version = 1` y timestamps server-side al insertar.
- Se amplió la validación de privilegios para comprobar que `service_role` no tenga DELETE físico ni UPDATE sobre auditoría.
- Se ampliaron sanity checks para INSERT manipulado, timestamps de pagos/asistencias/documentos, auditoría e idempotencia.
- Se agregó un runner reproducible que no requiere red, secretos ni Supabase CLI.

## Reproducción

```bash
bash supabase/validation/run_local_business_schema_v1.sh
```

Resultado requerido: `local_validation_complete | PASS`. Los logs y el clúster se guardan en la ruta temporal que imprime el runner.

## Límite de esta evidencia

Esta ejecución valida PostgreSQL 16, extensiones, DDL, RLS catalogado, grants, triggers, constraints y comportamiento de fixtures. Aún falta aplicar el mismo orden en un proyecto **Supabase de desarrollo**, donde debe repetirse la validación antes de implementar `pdmu-elements v2`. No se aplicó nada en producción.

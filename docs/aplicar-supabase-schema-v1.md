# Aplicar y validar Supabase business schema v1

## Advertencias

- Ejecutar primero en un proyecto Supabase de **desarrollo vacío o desechable**.
- No usar producción hasta revisar resultados, catálogos y plan de rollback.
- Los scripts no conectan React ni modifican workflows.
- Nunca colocar una service-role key en React, variables `VITE_*`, commits, logs o documentación.
- SQL Editor usa un rol elevado y puede omitir RLS. Las consultas desde SQL Editor no prueban por sí solas el acceso de `anon`/`authenticated`; el script estructural inspecciona privilegios directamente.

## Archivos y orden

1. `supabase/migrations/202606290001_business_schema_v1.sql`
2. `supabase/validation/validate_business_schema_v1.sql`
3. `supabase/seed/seed_business_schema_v1.sql`
4. `supabase/validation/sanity_checks_business_schema_v1.sql`

La migración se aplica una sola vez. Validación y sanity checks pueden repetirse. El seed usa IDs/códigos deterministas y `ON CONFLICT DO NOTHING`, pero está pensado para una base de desarrollo sin datos equivalentes.

## Validación local desechable

Cuando PostgreSQL 16, `pg_config` y `psql` están disponibles, el flujo completo puede ejecutarse sin credenciales ni conexión remota:

```bash
bash supabase/validation/run_local_business_schema_v1.sh
```

El runner:

- crea un clúster temporal bajo `/tmp`;
- usa el backend PostgreSQL single-user: no inicia servidor, socket ni listener TCP;
- crea stubs mínimos locales para `auth.users` y los roles que Supabase proporciona;
- ejecuta migración, validación, seed y sanity checks en ese orden;
- rechaza explícitamente cualquier `ERROR`, `FATAL` o `PANIC` porque single-user puede terminar con código 0 aun después de un error SQL;
- imprime evidencia de RLS/privilegios y conserva el clúster detenido para inspección manual.

No usar `PDMU_PG_TMPDIR` apuntando a un clúster existente: el runner invoca `initdb` y está diseñado exclusivamente para un directorio nuevo y desechable. El resultado local valida PostgreSQL, constraints y triggers; no sustituye la ejecución posterior en un proyecto Supabase de desarrollo.

## 1. Preparar el proyecto de desarrollo

1. Confirmar que el proyecto no sea producción.
2. Confirmar acceso al Dashboard y SQL Editor.
3. Guardar un backup si el proyecto ya contiene objetos.
4. Comprobar que Supabase Auth existe; la migración referencia `auth.users`.
5. No crear secrets ni copiar service-role al repositorio.

No hace falta crear usuarios Auth para aplicar el esquema. Solo `operator_profiles` requiere un UUID existente en `auth.users` al insertar perfiles.

## 2. Aplicar migración

1. Abrir Supabase Dashboard → SQL Editor.
2. Crear una consulta nueva.
3. Copiar completo `202606290001_business_schema_v1.sql`.
4. Ejecutar una vez.
5. Confirmar que la transacción termina en `COMMIT` sin errores.

Resultados esperados:

- Extensiones `pgcrypto` y `pg_trgm` disponibles en schema `extensions`.
- Siete tablas en `public`.
- Funciones y triggers creados.
- `created_at` forzado y protegido server-side; `version` forzada a 1 e incrementada server-side en elementos, pagos y asistencias.
- RLS habilitado y sin políticas de acceso directo.
- Privilegios revocados para `anon`/`authenticated`.
- `service_role` sin DELETE físico sobre tablas de negocio; idempotencia sí permite purga.

Si falla, no editar objetos manualmente para “hacerla pasar”. Guardar mensaje y línea, descartar/recrear el proyecto de desarrollo o preparar una migración correctiva revisada.

## 3. Ejecutar validación estructural

Copiar y ejecutar completo:

```text
supabase/validation/validate_business_schema_v1.sql
```

Comprueba sin insertar datos:

- Tablas y columnas críticas.
- RLS.
- Ausencia de privilegios CRUD para `anon` y `authenticated`.
- Ausencia intencional de policies.
- Índices y unique indexes parciales.
- Foreign keys y checks.
- Triggers y funciones.
- Extensiones.

Resultado esperado:

```text
validation_status | PASS
```

Cualquier `raise exception` indica que el esquema no coincide con v1 y debe investigarse antes de seguir.

## 4. Insertar seed ficticio

Copiar y ejecutar completo:

```text
supabase/seed/seed_business_schema_v1.sql
```

Inserta datos no reales con prefijos `PDMU-SEED`, `PAY-SEED`, `ATT-SEED`, UUIDs reservados `00000000-0000-4000-8000-*` y URLs `example.invalid`:

- Un elemento.
- Un documento.
- Un pago de junio de 2026.
- Una asistencia.
- Una entrada de auditoría.
- Una idempotency key.

No inserta operador: `operator_profiles.id` debe corresponder a un usuario real de `auth.users`. Para probar perfiles, crear manualmente un usuario ficticio en Authentication del proyecto de desarrollo y usar su UUID en una consulta separada; no insertar directamente en `auth.users`.

Resultado esperado:

```text
seed_status | PASS
```

La asistencia omite intencionalmente `attendance_date`; el trigger debe derivar `2026-06-29` en `America/Mexico_City`.

## 5. Ejecutar sanity checks

Copiar y ejecutar completo:

```text
supabase/validation/sanity_checks_business_schema_v1.sql
```

El script requiere el seed, abre una transacción y termina con `ROLLBACK`. Prueba:

- Rechazo de pago activo duplicado.
- Nuevo pago permitido después de cancelar el anterior.
- Rechazo de dos documentos activos del mismo tipo.
- Revisión reemplazada + revisión activa.
- Incremento automático de versiones, ignorando un valor manipulado por cliente.
- `created_at` asignado server-side e inmutable en actualizaciones, incluidos documentos, auditoría e idempotencia.
- Fecha de asistencia derivada server-side.
- UPDATE/DELETE bloqueados en `audit_log`.
- FKs de hijos y restricción de borrado del elemento.

Resultado esperado:

```text
sanity_status | PASS
```

Los intentos que deben fallar se capturan dentro de bloques PL/pgSQL. Una excepción no capturada significa fallo real. Como termina en rollback, no deja pagos/documentos adicionales ni cambios de estado.

## 6. Inspección manual recomendada

Después del seed:

```sql
select id, element_code, version, status
from public.elements
where element_code = 'PDMU-SEED-001';

select element_id, document_type, status, version
from public.element_documents
where element_id = '00000000-0000-4000-8000-000000000101';

select element_id, year, month, amount_cents, status, version
from public.payments
where payment_code = 'PAY-SEED-001';

select element_id, occurred_at, attendance_date, status, version
from public.attendance_records
where attendance_code = 'ATT-SEED-001';
```

Esperado:

- `amount_cents = 20000`.
- `attendance_date = 2026-06-29`.
- Versiones iniciales = 1.
- Un documento activo `birth_certificate`.

## 7. Limpiar datos de prueba

Solo en desarrollo y desde SQL Editor con rol propietario:

```sql
begin;

delete from public.idempotency_keys
where key = 'idem-seed-business-schema-v1';

delete from public.attendance_records
where id = '00000000-0000-4000-8000-000000000401';

delete from public.payments
where id = '00000000-0000-4000-8000-000000000301';

delete from public.element_documents
where id = '00000000-0000-4000-8000-000000000201';

alter table public.audit_log disable trigger audit_log_append_only;

delete from public.audit_log
where id = '00000000-0000-4000-8000-000000000501';

alter table public.audit_log enable trigger audit_log_append_only;

delete from public.elements
where id = '00000000-0000-4000-8000-000000000101';

commit;
```

Deshabilitar el trigger de auditoría solo está permitido para retirar este fixture conocido en desarrollo. No incorporar ese patrón a workflows ni usarlo para datos reales.

## 8. Validar RLS desde cliente

La estructura deja cero acceso directo a `anon`/`authenticated`. Antes de cualquier futura política, una consulta PostgREST con publishable key debe recibir permiso denegado o cero acceso según cliente/configuración. Esta prueba debe hacerse manualmente fuera del repositorio, sin guardar claves.

No habilitar policies generales como `using (true)` ni conceder CRUD para “desbloquear” pruebas. React seguirá hablando con n8n.

## 9. Criterio para aprobar el esquema

- Migración aplicada sin error en desarrollo.
- Validación estructural = PASS.
- Seed = PASS.
- Sanity checks = PASS.
- Limpieza probada.
- RLS/privilegios revisados.
- Catálogos y decisiones pendientes aceptados.
- Ninguna conexión de React ni workflow productivo modificados.

Solo después procede implementar el primer workflow v2 en un entorno de desarrollo.

# Modelo de datos Supabase v1

Estado: estructura preparada, todavía no conectada a React ni a workflows activos.  
Migración SQL: `supabase/migrations/202606290001_business_schema_v1.sql`.

## Objetivo

Supabase será la fuente principal futura para datos de negocio. n8n seguirá siendo la capa de operaciones sensibles y el orquestador de Drive, QR, correo y reglas server-side. React no consulta estas tablas directamente en esta fase.

El modelo reemplaza filas y columnas de Sheets por entidades relacionadas, IDs internos estables, restricciones de integridad, cancelación lógica, auditoría e idempotencia. Google Sheets permanecerá temporalmente como legado/respaldo/exportación durante la transición.

## Diagrama lógico

```text
auth.users
   │ 1:1
   ▼
operator_profiles
   │
   ├──── recorded_by / cancelled_by ────┐
   │                                     │
elements ── 1:N ── element_documents    │
   │                                     │
   ├────── 1:N ── payments ◄────────────┤
   │                                     │
   └────── 1:N ── attendance_records ◄──┘

audit_log          (traza transversal append-only)
idempotency_keys   (control transversal de reintentos)
```

## Decisiones generales

- Todas las entidades internas usan UUID.
- `elements.element_code` conserva el `ID` actual como identificador de negocio.
- Pagos y asistencias referencian `elements.id`; no duplican nombres.
- Los documentos dejan de ser columnas y pasan a filas de `element_documents`.
- Los pagos conservan una fila por mensualidad.
- Cancelar no elimina: cambia el estado y conserva motivo, actor y timestamp.
- `version` empieza forzosamente en 1 y se incrementa automáticamente al actualizar elementos, pagos y asistencias; valores enviados en insert/update no pueden forzar el contador.
- `created_at` es asignado server-side al insertar y se conserva al actualizar. `updated_at` también se controla server-side en las tablas que lo incluyen.
- `attendance_date` se conserva como fecha operativa para filtros; un trigger la deriva desde `occurred_at` usando `America/Mexico_City` y no confía en el valor enviado.
- Dinero se almacena en centavos enteros, no en decimal/float.
- Catálogos simples permanecen como `text` con checks donde ya hay una decisión estable. No se crearon tablas de catálogo prematuramente.
- Se habilita RLS sin políticas y se revocan privilegios a `anon`/`authenticated`. Solo una integración server-side autorizada debe operar las tablas por ahora.

## Tablas

### `operator_profiles`

Vincula al usuario de Supabase Auth con el operador interno.

| Campo | Uso |
|---|---|
| `id` | Mismo UUID que `auth.users.id`; PK y FK con borrado en cascada. |
| `email` | Copia operativa normalizada; índice único case-insensitive. Auth sigue siendo autoridad de identidad. |
| `display_name` | Nombre visible del operador. |
| `role` | `operator` o `admin`; no existe UI de roles todavía. |
| `status` | `active` o `inactive`. |
| `created_at`, `updated_at` | Auditoría temporal. |

La sincronización de email/perfil desde `auth.users` se definirá en la fase de workflows o mediante trigger controlado. No se incluye ahora para no introducir automatización no probada.

### `elements`

Registro canónico de elementos.

| Campo | Uso |
|---|---|
| `id` | UUID interno usado por relaciones. |
| `element_code` | ID actual de negocio, único tras trim y sin distinguir mayúsculas/minúsculas. |
| `given_names`, `paternal_surname`, `maternal_surname` | Nombre normalizado sin duplicarlo en otras tablas. |
| `birth_date`, `sex_code`, `group_code` | Datos personales/organizativos. |
| `medical_notes` | Información sensible de salud. |
| `guardian_name`, `guardian_phone` | Contacto del tutor. |
| `qr_value` | Valor o referencia QR actual; único cuando existe. |
| `drive_folder_id`, `drive_folder_url` | Metadata de la carpeta Drive, no documentos individuales. |
| `status` | `active`, `inactive` o `archived`. |
| `version` | Control optimista de concurrencia. |
| timestamps | Creación y última actualización. |

Índices:

- Código de elemento.
- Status y grupo/status.
- Búsqueda trigram por nombres y apellidos.
- Unicidad parcial de QR y carpeta Drive.

`group_code` permanece nullable porque el frontend actual envía `grupo` pero no presenta un control para capturarlo. Negocio debe decidir si el campo sigue vigente.

### `element_documents`

Una fila por documento o revisión documental.

| Campo | Uso |
|---|---|
| `id` | UUID del documento/revisión. |
| `element_id` | FK a `elements.id`. |
| `document_type` | Tipo canónico, por ejemplo `birth_certificate`. |
| `drive_file_id`, `drive_url` | Metadata de Drive. |
| `original_filename`, `mime_type`, `size_bytes` | Metadata verificable del archivo. |
| `status` | `active`, `replaced` o `cancelled`. |
| `version` | Número de revisión dentro del tipo. |
| `replaces_document_id` | Referencia opcional a la revisión anterior. |
| `uploaded_at`, `replaced_at`, `created_at` | Trazabilidad temporal. |

Solo puede existir una revisión `active` por elemento/tipo; las anteriores permanecen como `replaced`. El reemplazo debe ejecutarse en una transacción: marcar anterior, insertar nueva y auditar.

La tabla almacena metadata, no bytes. Drive puede continuar almacenando archivos durante la primera migración; una futura adopción de Supabase Storage no requiere volver a remodelar las relaciones.

### `payments`

Una fila por elemento, año y mes.

| Campo | Uso |
|---|---|
| `id` | UUID interno. |
| `payment_code` | Conserva `ID Pago` legado o recibe un código nuevo. |
| `element_id` | FK a elemento; reemplaza ID/nombre duplicados. |
| `year`, `month` | Periodo, con mes entero 1–12. |
| `amount_cents`, `currency` | Monto entero; moneda predeterminada MXN. |
| `method`, `reference` | Medio y referencia opcional. |
| `status` | `posted` o `cancelled`. |
| `recorded_at`, `recorded_by` | Cuándo y quién registró. |
| datos de cancelación | `cancelled_at`, `cancelled_by`, `cancel_reason`. |
| `version`, timestamps | Concurrencia y auditoría básica. |

Un índice único parcial impide dos pagos `posted` del mismo elemento/año/mes. Un pago cancelado conserva historia y permite registrar posteriormente el pago correcto.

### `attendance_records`

Eventos de asistencia sin duplicar datos personales.

| Campo | Uso |
|---|---|
| `id` | UUID interno. |
| `attendance_code` | Conserva `ID Asistencia` o recibe código nuevo. |
| `element_id` | FK a elemento. |
| `occurred_at` | Instante real en UTC. |
| `attendance_date` | Fecha operativa en zona `America/Mexico_City`. |
| `status` | `present`, `absent`, `late`, `excused`. |
| `source` | `manual`, `qr` o `legacy_import`. |
| `record_status` | `active` o `cancelled`. |
| `recorded_by` | Operador que registró/corrigió originalmente. |
| datos de cancelación | Timestamp, actor y motivo. |
| `version`, timestamps | Concurrencia y trazabilidad. |

No se impone todavía “una asistencia por día” porque debe definirse si el negocio maneja múltiples eventos, entradas/salidas o una sola marca diaria. La idempotencia y la regla semántica se implementarán server-side cuando esa decisión exista.

### `audit_log`

Registro append-only de operaciones sensibles.

- UUID del actor capturado desde la sesión validada. No usa FK para conservar la traza incluso si el usuario Auth se elimina.
- Acción, tipo de entidad e ID.
- `before_data` y `after_data` JSONB.
- Motivo y `request_id` para correlación.
- Timestamp server-side.

Un trigger bloquea `UPDATE` y `DELETE`. No almacenar JWT, refresh tokens, OTP, archivos, secretos ni payloads completos sin redacción. Los datos before/after deben limitarse a campos necesarios.

### `idempotency_keys`

Registro server-side para impedir reejecuciones de inscripciones, pagos, asistencias, documentos y cancelaciones.

Además de los campos solicitados incluye:

- `actor_user_id` para comprobar propietario del intento.
- `status`: `pending`, `completed`, `failed`.
- `response_status` para reconstruir una respuesta previa.

La combinación lógica validada por el workflow es clave + actor + acción + hash. La PK sigue siendo `key`, por lo que se recomiendan UUID aleatorios. Las respuestas cacheadas no deben guardar tokens ni PII innecesaria y deben purgarse después de `expires_at` mediante una tarea server-side futura.

## Mapeo desde Sheets

### Hoja `Elementos` → `elements`

| Sheets | Supabase | Transformación |
|---|---|---|
| `ID` | `element_code` | Se conserva exactamente tras trim; `id` UUID se genera aparte. |
| `Apellido paterno` | `paternal_surname` | Trim y normalización de espacios. |
| `Apellido materno` | `maternal_surname` | Vacío → `null`. |
| `Nombre(s)` | `given_names` | Trim y normalización de espacios. |
| `Fecha de nacimiento` | `birth_date` | Parsear explícitamente a `YYYY-MM-DD`; no confiar en locale automático. |
| `Sexo` | `sex_code` | Mapear catálogo legado al código aprobado. |
| `Enfermedades` | `medical_notes` | Vacío/“Ninguna” según regla acordada → `null` o texto. |
| `Tutor` | `guardian_name` | Trim. |
| `Telefono del tutor` | `guardian_phone` | Importar como texto, nunca número; conservar ceros iniciales. |
| `Grupo` | `group_code` | Vacío → `null`; catálogo pendiente. |
| `QR` | `qr_value` | Extraer el valor real o referencia; revisar duplicados. |
| `drive` | `drive_folder_id`, `drive_folder_url` | Separar ID de carpeta y URL cuando sea posible. |
| columnas de documentos | `element_documents` | Una fila por columna con valor válido. |

### Columnas documentales → `element_documents`

| Columna Sheets | `document_type` sugerido |
|---|---|
| `ineTutor` | `guardian_id` |
| `certificadoMedico` | `medical_certificate` |
| `comprobanteDomicilio` | `proof_of_address` |
| `actaNacimiento` | `birth_certificate` |
| `curp` | `curp` |
| `hojaInscripcion` | `enrollment_form` |

Por cada URL no vacía y distinta de “Sin documento”:

1. Resolver `element_id` mediante `element_code`.
2. Extraer `drive_file_id` si la URL lo permite.
3. Conservar URL original como metadata temporal.
4. Crear revisión `active`, versión 1.
5. Registrar excepciones de URL inválida para revisión, no descartarlas silenciosamente.

### Hoja `Pagos` → `payments`

| Sheets | Supabase | Transformación |
|---|---|---|
| `ID Pago` | `payment_code` | Conservar; generar código de migración solo si falta. |
| `ID Elemento` | `element_id` | Join `elements.element_code → elements.id`. |
| `Nombre Elemento` | Eliminado | Se obtiene por relación; usar solo para conciliación. |
| `Mes` | `month` | Enero–Diciembre → 1–12; valores desconocidos a excepciones. |
| `Año` | `year` | Entero validado. |
| `Cantidad` | `amount_cents` | Parsear moneda y multiplicar por 100; nunca float. |
| `Tipo de Pago` | `method` | Mapear `Efectivo → cash`, `Transferencia → transfer`. |
| `Fecha Registro` | `recorded_at` | Parsear con zona horaria documentada y almacenar UTC. |

Importación inicial usa `status = posted`, `version = 1`. Si existen cancelaciones históricas no representadas en Sheets, deben recuperarse desde otra fuente o registrarse como limitación.

### Hoja `Asistencias` → `attendance_records`

| Sheets | Supabase | Transformación |
|---|---|---|
| `ID Elemento` | `element_id` | Join por `element_code`. |
| `ID Asistencia` | `attendance_code` | Conservar; generar solo si falta. |
| apellidos y nombre | Eliminados | Validar contra elemento durante conciliación, no persistir duplicados. |
| `Fecha y hora` | `occurred_at`, `attendance_date` | Parsear explícitamente en `America/Mexico_City`; guardar instante UTC y fecha local. |
| `Estado` | `status` | `Asistencia → present`, `Falta → absent`, `Retardo → late`, `Justificada → excused`. |

Importación: `source = legacy_import`, `record_status = active`, `version = 1`.

### Sin origen en Sheets

| Tabla/campo | Origen futuro |
|---|---|
| `operator_profiles` | Supabase Auth y alta administrativa controlada. |
| `audit_log` | Workflows v2/gateway. No inventar historial previo. |
| `idempotency_keys` | Requests nuevos; no se migra. |
| `recorded_by`, `cancelled_by` | `null` en legacy salvo que exista fuente confiable. |
| `version` | Empieza en 1 para datos importados. |

## Qué se conserva

- IDs actuales: `ID`, `ID Pago`, `ID Asistencia` como códigos de negocio.
- Datos personales, tutor, grupo, salud y metadata Drive/QR.
- Una fila por mensualidad.
- Estado y fecha de cada asistencia.
- Fechas/montos/métodos de pagos, después de normalización.

## Qué se elimina del modelo público

- `row_number`.
- `sheet` y `operacion`.
- Nombre/apellidos duplicados en pagos y asistencias.
- Nombre completo persistido en pagos.
- Un documento por columna.
- Borrado físico como operación normal.
- Cantidades monetarias ambiguas en pesos/float.
- Fechas dependientes del locale de Sheets.

## Por qué no se duplican nombres

Pagos y asistencias pertenecen a un elemento mediante `element_id`. El nombre actual se obtiene con un join. Esto evita que una corrección de nombre deje miles de registros históricos con textos distintos y evita usar el nombre como identidad.

Para reportes históricos que legalmente necesiten una “foto” del nombre al momento del evento, esa necesidad debe aprobarse explícitamente y modelarse como snapshot auditado; no se debe conservar duplicación accidental de Sheets.

## Por qué los documentos son filas

Una columna por tipo impide historial, múltiples revisiones, metadata uniforme y tipos nuevos sin alterar esquema. `element_documents` permite:

- Agregar tipos sin nueva columna.
- Reemplazar conservando revisión anterior.
- Registrar tamaño, MIME, hash/ID Drive y estado.
- Auditar cargas/cancelaciones.
- Cambiar Drive por otro almacenamiento sin tocar `elements`.

## Seguridad inicial

- RLS habilitado en las siete tablas.
- Sin políticas para `anon` o `authenticated`.
- Privilegios directos revocados a ambos roles.
- `service_role` puede leer/insertar/actualizar tablas de negocio, pero no borrar físicamente elementos, documentos, pagos o asistencias; `audit_log` solo permite select/insert y además tiene trigger append-only. `idempotency_keys` sí admite delete para purga por expiración.
- Una service-role key jamás debe entrar en React, `VITE_*`, documentación o repositorio.
- Cuando existan roles/permisos definitivos podrán añadirse funciones/políticas específicas, pero React seguirá usando n8n para operaciones sensibles.

## Decisiones pendientes

1. Catálogos definitivos de `sex_code`, `group_code`, documentos, métodos y estados.
2. Validez y formato de `grupo`, que hoy llega vacío desde la UI.
3. Regla de duplicado de elementos.
4. Regla semántica de asistencia duplicada por día/evento.
5. Política de retención/reemplazo documental.
6. Tratamiento de URLs Drive inválidas o múltiples archivos por tipo.
7. Zona horaria histórica si algunos registros no corresponden a Ciudad de México.
8. Política de conservación de pagos cancelados y referencias.
9. Cómo se sincroniza `operator_profiles.email` ante cambios en Auth.
10. Retención y redacción de `audit_log` e `idempotency_keys`.

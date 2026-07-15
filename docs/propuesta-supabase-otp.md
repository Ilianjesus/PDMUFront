# Propuesta técnica: Supabase y login passwordless OTP

Fecha: 28 de junio de 2026  
Estado: Supabase Auth OTP implementado; modelo de datos y migración no implementados  
Alcance: arquitectura futura, modelo de datos, contrato OTP y plan de migración.  

> Actualización del 28 de junio de 2026: React ya solicita y verifica OTP con Supabase Auth, y el dueño reporta habilitado el Send Email Hook hacia `https://n8n.scolaris.com.mx/webhook/pdmu-otp`. React no llama ese endpoint. Falta la prueba end-to-end; roles y toda migración de datos permanecen pendientes. Véase `docs/auth-supabase-otp.md`.

## 1. Resumen ejecutivo

La evolución recomendada es gradual: conservar React → n8n como frontera de negocio mientras Supabase se introduce primero como plataforma de identidad, autorización, auditoría y almacenamiento estructurado. React no debería conectarse directamente a tablas sensibles durante las primeras fases. n8n puede seguir orquestando inscripciones, pagos y asistencias, pero debe dejar de ser una URL pública sin identidad verificable antes de que Supabase se vuelva la fuente principal.

Para passwordless, la opción preferida es **Supabase Auth como autoridad OTP y emisora de sesión**, con una fachada backend de autenticación para la app. Supabase genera y verifica el código; un Send Email Hook controlado recibe el material de entrega y llama a un webhook n8n firmado. n8n únicamente orquesta el correo con el proveedor configurado por el dueño. React nunca genera, almacena, valida ni envía el OTP por correo.

No se recomienda construir de entrada una autoridad OTP totalmente propia: además de generar y comparar códigos, obligaría a diseñar emisión, rotación, renovación y revocación de sesiones compatibles con Supabase/RLS. Solo debería elegirse si una prueba técnica demuestra que Supabase Auth y su Send Email Hook no satisfacen el contrato operativo requerido.

El orden de migración recomendado es:

1. Identidades de operadores, roles y permisos.
2. Auditoría inmutable de operaciones.
3. Pagos y mensualidades, primero en modo sombra y con conciliación.
4. Asistencias.
5. Inscripciones, tutores y documentos.

P0 ya desacopló la UI de Firebase y P1 aisló n8n detrás de servicios. Esas dos fronteras permiten cambiar identidad y persistencia por etapas sin reescribir las páginas.

## 2. Decisión arquitectónica recomendada

```text
                           AUTENTICACIÓN FUTURA

 React
   │  request/verify OTP
   ▼
 Auth Controller / fachada confiable
   │
   ├── Supabase Auth ─────────────── JWT/sesión verificable
   │      │
   │      └── Send Email Hook
   │              ▼
   │       Adaptador de entrega confiable
   │              │ webhook firmado
   │              ▼
   │             n8n ─────────────── proveedor de correo del dueño
   │
   └── registro de challenge/auditoría sin OTP en texto plano

                         OPERACIONES DE NEGOCIO

 React ── sesión/token ──► n8n / API de negocio
                              │
                              ├── Fase A: Sheets / n8n Tables
                              ├── Fase B: legado + Supabase sombra
                              └── Fase C: Supabase DB/Storage principal
```

La fachada puede ser una Supabase Edge Function o un backend equivalente, pero debe ejecutarse fuera del navegador. No se decide su tecnología en este documento. Su responsabilidad es exponer un contrato estable a React, aplicar límites y no revelar detalles del proveedor de identidad.

Supabase Auth soporta OTP por correo y sesiones JWT. También ofrece un Send Email Hook que reemplaza el envío incorporado, lo que permite mantener el correo bajo la orquestación definida por el dueño sin entregar esa responsabilidad a React. La configuración real del hook, del adaptador y de n8n queda fuera de esta tarea. Véanse las referencias oficiales al final.

### Opción recomendada: Supabase Auth como autoridad OTP

- Supabase Auth genera y verifica el OTP.
- La fachada crea un `challengeId` opaco para el contrato de React y asocia el challenge al correo normalizado.
- El Send Email Hook entrega el OTP a un adaptador backend verificado.
- El adaptador transforma el evento al contrato mínimo de n8n y firma la llamada.
- La verificación resuelve el correo por `challengeId` y pide a Supabase Auth verificar el código.
- Supabase emite la sesión; `AuthContext` recibe una identidad normalizada.
- Si el sistema es solo para operadores preautorizados, debe impedirse el alta automática de usuarios.

### Alternativa no preferida: autoridad OTP propia

- Un backend genera un código con CSPRNG, almacena únicamente su hash/HMAC y verifica en tiempo constante.
- El mismo backend debe emitir o intercambiar una sesión verificable, gestionar refresh/revocación y hacerla compatible con RLS.
- Esta alternativa duplica capacidades de Supabase Auth y aumenta la superficie de seguridad.
- Solo se justifica si existe un requisito probado que no pueda resolverse con Auth Hooks/fachada.

### Prueba técnica necesaria antes de implementar

Validar en un proyecto no productivo que el Send Email Hook entrega los campos necesarios para OTP, que el adaptador puede correlacionar el evento con el challenge activo y que la verificación backend devuelve una sesión renovable. Si la correlación con `challengeId` no fuera suficientemente robusta, se debe ajustar la fachada antes de decidir por un sistema OTP propio.

## 3. Convenciones del modelo de datos

- PK internas: UUID generadas en servidor.
- IDs actuales de Sheets/n8n: conservarlos como `legacy_id` o en una tabla de mapeo, nunca como única PK nueva.
- Fechas: `timestamptz` en UTC; presentar en `America/Mexico_City` en UI.
- Periodos mensuales: `smallint year` + `smallint month`, con checks; no guardar “Enero 2026” como dato principal.
- Dinero: enteros en centavos (`amount_cents bigint`) y `currency char(3)` para evitar ambigüedad decimal.
- Borrado: preferir `status`, `archived_at` o reversión. No usar cascada sobre pagos, asistencias o auditoría.
- Trazabilidad: `created_at`, `updated_at`, `created_by`, `updated_by` donde aplique.
- Concurrencia: `version integer` o `updated_at` comprobado en mutaciones sensibles.
- Datos externos: `source_system`, `source_record_id`, `migration_batch_id` e `idempotency_key` durante coexistencia.
- RLS: habilitada y deny-by-default en toda tabla de un esquema expuesto. Las tablas privadas de OTP/auditoría no deben exponerse al cliente.
- No se introduce `organization_id` hasta que el dueño confirme si habrá múltiples zonas/unidades con aislamiento de datos.

## 4. Modelo de datos propuesto

### Resumen de migración

| Tabla | Prioridad | Momento sugerido |
|---|---:|---|
| `operators` | P0 | Primero, junto con la decisión de Auth. |
| `operator_identities` | P0 | Primero, para coexistencia Firebase/Supabase. |
| `roles`, `permissions` | P0 | Primero, después de aprobar matriz de permisos. |
| `operator_roles`, `role_permissions` | P0 | Primero. |
| `audit_log` | P0 | Primero; antes de migrar operaciones sensibles. |
| `elements` | P3 | Después de pagos/asistencias, con limpieza de datos. |
| `guardians`, `element_guardians` | P3 | Junto con inscripciones. |
| `documents` | P3 | Al final, tras definir Storage, retención y privacidad. |
| `monthly_dues` | P1 | Después de identidad/auditoría, inicialmente sombra. |
| `payment_transactions` | P1 | Después de identidad/auditoría, inicialmente sombra. |
| `payment_allocations` | P1 | Junto con pagos si se aceptan pagos múltiples/parciales. |
| `attendance_events` | P2 | Después de pagos; requiere definir actividad/evento. |
| `attendance_records` | P2 | Después de pagos, inicialmente sombra. |
| `otp_challenges` | Condicional | Solo al implementar fachada OTP; no almacenar OTP si Supabase es autoridad. |
| `legacy_record_map` | Temporal | Antes de cualquier migración de datos. |

### 4.1 `operators`

**Propósito:** representar a la persona operadora dentro del dominio de PDMU, independientemente del proveedor de login.

**Campos principales:**

- `id uuid`.
- `email_normalized text`.
- `display_name text`.
- `status text` (`active`, `suspended`, `invited`, `archived`).
- `last_login_at timestamptz`.
- `created_at`, `updated_at`, `archived_at`.
- `created_by uuid` nullable para el primer bootstrap.

**PK:** `id`.

**Relaciones:** roles, identidades, pagos recibidos, asistencias registradas, documentos subidos y auditoría.

**Índices:** unique sobre `email_normalized` para operadores activos según política; índice por `status`; índice por `last_login_at` solo si se usa operacionalmente.

**Datos sensibles:** correo, nombre, estado de acceso y actividad de login.

**Migración:** primera. Crear operadores preautorizados antes de habilitar OTP. No permitir auto-registro público por defecto.

### 4.2 `operator_identities`

**Propósito:** desacoplar el operador de Firebase/Supabase y permitir una transición sin cambiar las FK de negocio.

**Campos principales:**

- `id uuid`.
- `operator_id uuid`.
- `provider text` (`firebase`, `supabase`).
- `provider_subject text` (Firebase UID o Supabase `auth.users.id`).
- `provider_email text`.
- `linked_at`, `last_seen_at`, `disabled_at`.

**PK:** `id`.

**Relaciones:** FK a `operators.id`. Cuando el provider sea Supabase, el subject debe corresponder a `auth.users.id`; puede añadirse una FK específica si el diseño final lo permite.

**Índices:** unique (`provider`, `provider_subject`); índice (`operator_id`, `provider`); no permitir dos identidades activas equivalentes sin proceso explícito de vinculación.

**Datos sensibles:** identificadores de identidad y correo.

**Migración:** primera. Permite mantener Firebase durante el piloto OTP y retirar su vínculo después sin cambiar `operator_id`.

### 4.3 `roles`

**Propósito:** catálogo de roles de negocio, distinto del rol Postgres/Supabase `authenticated`.

**Campos principales:** `id uuid`, `key text`, `name text`, `description text`, `is_system boolean`, timestamps.

**PK:** `id`.

**Relaciones:** operadores mediante `operator_roles`; permisos mediante `role_permissions`.

**Índices:** unique sobre `key`.

**Datos sensibles:** bajos, aunque revela estructura organizacional.

**Migración:** primera, pero no sembrar roles inventados. Nombres como administrador/caja/instructor son ejemplos hasta que el dueño apruebe la matriz.

### 4.4 `permissions`

**Propósito:** catálogo estable de capacidades, por ejemplo `payments.read`, `payments.create`, `attendance.update`.

**Campos principales:** `id uuid`, `key text`, `resource text`, `action text`, `description text`.

**PK:** `id`.

**Relaciones:** roles mediante `role_permissions`.

**Índices:** unique sobre `key`; opcional (`resource`, `action`) unique.

**Datos sensibles:** bajos.

**Migración:** primera, después de inventariar operaciones reales de PDMU.

### 4.5 `operator_roles`

**Propósito:** asignar roles a operadores con trazabilidad y vigencia.

**Campos principales:** `operator_id`, `role_id`, `granted_by`, `granted_at`, `expires_at`, `revoked_at`.

**PK:** compuesta (`operator_id`, `role_id`) si solo se conserva la asignación vigente; UUID propia si se requiere historial completo. Se recomienda UUID + restricción unique parcial para una asignación activa.

**Relaciones:** operadores y roles.

**Índices:** (`operator_id`) para autorización; (`role_id`); unique parcial de asignación activa.

**Datos sensibles:** permisos del personal.

**Migración:** primera.

### 4.6 `role_permissions`

**Propósito:** asociar capacidades a cada rol.

**Campos principales:** `role_id`, `permission_id`, `created_at`, `created_by`.

**PK:** compuesta (`role_id`, `permission_id`).

**Relaciones:** roles y permisos.

**Índices:** el PK cubre consulta por rol; agregar índice por `permission_id` si se consulta de forma inversa.

**Datos sensibles:** configuración de autorización.

**Migración:** primera. Cambios deben generar auditoría.

### 4.7 `elements`

**Propósito:** registro principal de integrantes/elementos inscritos.

**Campos principales:**

- `id uuid`.
- `legacy_id text`.
- `first_names`, `paternal_surname`, `maternal_surname`.
- `birth_date date`.
- `sex_code text`.
- `group_code text` inicialmente; catálogo posterior si existe definición oficial.
- `medical_conditions text` o estructura separada según política de acceso.
- `status text`.
- `enrolled_at`, timestamps, `archived_at`.
- `source_system`, `source_record_id`, `version`.

**PK:** `id`.

**Relaciones:** tutores, documentos, mensualidades, pagos asignados y asistencias.

**Índices:** unique sobre `legacy_id` cuando esté limpio; índice por `status`; búsqueda normalizada de nombre solo después de definir volumen; índice por `group_code`.

**Datos sensibles:** identidad, fecha de nacimiento, sexo y condiciones médicas; posiblemente datos de menores.

**Migración:** después. Requiere deduplicación, reglas de retención y matriz de acceso antes de importar.

### 4.8 `guardians`

**Propósito:** representar tutores/contactos sin duplicarlos dentro de cada inscripción.

**Campos principales:** `id uuid`, `full_name text`, `phone_normalized text`, `email_normalized text`, `status`, timestamps.

**PK:** `id`.

**Relaciones:** elementos mediante `element_guardians`.

**Índices:** teléfono y correo solo si se usarán para búsqueda/deduplicación; no asumir que son únicos globalmente.

**Datos sensibles:** nombre, teléfono y correo de terceros.

**Migración:** junto con inscripciones, después de definir reglas de deduplicación.

### 4.9 `element_guardians`

**Propósito:** relación muchos-a-muchos y datos contextuales del contacto.

**Campos principales:** `element_id`, `guardian_id`, `relationship text`, `is_primary boolean`, `can_pick_up boolean` solo si el negocio lo requiere, timestamps.

**PK:** compuesta (`element_id`, `guardian_id`).

**Relaciones:** elementos y tutores.

**Índices:** índice por `guardian_id`; unique parcial para un tutor principal por elemento si esa regla es real.

**Datos sensibles:** relación familiar y autorizaciones.

**Migración:** junto con tutores/inscripciones.

### 4.10 `documents`

**Propósito:** metadatos y ciclo de vida de documentos; el archivo binario debe vivir en un bucket privado, no en la tabla.

**Campos principales:**

- `id uuid`, `element_id uuid`.
- `document_type text`.
- `bucket_id text`, `object_path text`.
- `original_filename text`, `mime_type text`, `size_bytes bigint`, `checksum_sha256 text`.
- `status text` (`pending`, `available`, `rejected`, `replaced`, `deleted`).
- `uploaded_by uuid`, `uploaded_at`, `replaced_by_document_id`, `retention_until`.
- `scan_status text` si se incorpora análisis antimalware.

**PK:** `id`.

**Relaciones:** elemento, operador y documento reemplazante.

**Índices:** (`element_id`, `document_type`, `status`); unique sobre `object_path`; checksum para detectar duplicados solo si conviene.

**Datos sensibles:** muy altos: INE, acta, CURP, certificado médico, domicilio y hoja de inscripción.

**Migración:** al final. Requiere bucket privado, políticas, URLs firmadas breves, límites, escaneo, retención y borrado aprobados. Supabase Storage usa políticas RLS en `storage.objects`; las service keys omiten esas políticas y nunca deben estar en el navegador.

### 4.11 `monthly_dues`

**Propósito:** representar la obligación mensual independientemente del acto de pagar.

**Campos principales:** `id uuid`, `element_id`, `year smallint`, `month smallint`, `expected_amount_cents`, `currency`, `status`, `due_date`, `waived_amount_cents`, `notes`, timestamps, `version`.

**PK:** `id`.

**Relaciones:** elemento y asignaciones de pago.

**Índices:** unique (`element_id`, `year`, `month`); (`year`, `month`, `status`); `element_id`.

**Datos sensibles:** situación de pago de una persona.

**Migración:** primera entidad de negocio, después de identidad/auditoría. La tarifa no debe fijarse en el esquema hasta resolver becas, descuentos y recargos.

### 4.12 `payment_transactions`

**Propósito:** registrar el movimiento recibido, sin sobrescribir ni borrar historia financiera.

**Campos principales:**

- `id uuid`, `legacy_id text`.
- `element_id uuid`.
- `amount_cents bigint`, `currency char(3)`.
- `payment_method text`, `reference text`.
- `paid_at timestamptz`, `received_by uuid`.
- `status text` (`posted`, `voided`, `refunded`).
- `voided_at`, `voided_by`, `void_reason`.
- `idempotency_key text`, `source_system`, `source_record_id`, timestamps.

**PK:** `id`.

**Relaciones:** elemento, operador, asignaciones y auditoría.

**Índices:** unique sobre `idempotency_key` cuando exista; `element_id, paid_at desc`; `status`; referencia según método. `legacy_id` unique solo tras conciliación.

**Datos sensibles:** historial financiero y operador receptor.

**Migración:** alta prioridad, en modo sombra. Evitar hard delete; una corrección debe ser reversión auditada.

### 4.13 `payment_allocations`

**Propósito:** asignar una transacción a una o varias mensualidades y soportar pagos múltiples o parciales sin codificar meses en un string.

**Campos principales:** `id uuid`, `payment_id`, `monthly_due_id`, `allocated_amount_cents`, timestamps.

**PK:** `id`.

**Relaciones:** transacción y obligación mensual.

**Índices:** unique (`payment_id`, `monthly_due_id`); índice por `monthly_due_id`.

**Datos sensibles:** detalle financiero.

**Migración:** junto con pagos si el dueño confirma pagos parciales/múltiples; de lo contrario conservar el diseño para no cerrar esa posibilidad.

### 4.14 `attendance_events`

**Propósito:** representar la actividad a la que se toma asistencia, evitando que `Tipo` y fecha queden como texto repetido.

**Campos principales:** `id uuid`, `event_type text`, `name text`, `starts_at`, `ends_at`, `group_code`, `status`, `created_by`, timestamps.

**PK:** `id`.

**Relaciones:** registros de asistencia.

**Índices:** `starts_at desc`; (`group_code`, `starts_at`); `status`.

**Datos sensibles:** bajos por sí solos; pueden revelar actividad operativa.

**Migración:** después de pagos. Antes se debe definir si cada escaneo pertenece a un evento explícito o si el workflow lo infiere.

### 4.15 `attendance_records`

**Propósito:** estado de un elemento en una actividad.

**Campos principales:** `id uuid`, `event_id`, `element_id`, `status` (`present`, `absent`, `late`, `excused`), `recorded_at`, `recorded_by`, `source` (`manual`, `qr`, `migration`), `notes`, `idempotency_key`, `source_record_id`, timestamps, `version`.

**PK:** `id`.

**Relaciones:** evento, elemento y operador.

**Índices:** unique (`event_id`, `element_id`); `element_id, recorded_at desc`; `event_id, status`; unique de `idempotency_key` si se genera.

**Datos sensibles:** historial de presencia y posibles justificaciones.

**Migración:** después de pagos. Comenzar con shadow-write y conciliación de conteos por evento/día.

### 4.16 `audit_log`

**Propósito:** bitácora append-only de lectura sensible y mutaciones administrativas.

**Campos principales:**

- `id uuid`, `occurred_at timestamptz`.
- `actor_operator_id uuid` nullable para procesos del sistema.
- `actor_identity_subject text`.
- `action text`, `entity_type text`, `entity_id uuid/text`.
- `request_id text`, `correlation_id text`, `source text` (`react`, `n8n`, `migration`, `system`).
- `result text`, `reason text`.
- `before_data jsonb`, `after_data jsonb` con redacción.
- `ip_hash text`, `user_agent_hash text` cuando la política lo permita.

**PK:** `id`.

**Relaciones:** referencia lógica a cualquier entidad; FK solo para actor, porque la auditoría debe sobrevivir al archivado.

**Índices:** `occurred_at desc`; (`entity_type`, `entity_id`, `occurred_at`); (`actor_operator_id`, `occurred_at`); `request_id`.

**Datos sensibles:** altos; puede contener quién accedió o cambió datos. No almacenar OTP, tokens, archivos, secretos ni snapshots completos de información médica/documental.

**Migración:** primera. Esquema privado, inserción controlada, sin update/delete para operadores. Definir retención y acceso de auditor antes de activar.

### 4.17 `otp_challenges` — condicional

**Propósito:** soportar el `challengeId` de la fachada, límites, estado de entrega y correlación. No sustituye el almacenamiento interno de Supabase Auth cuando este sea la autoridad.

**Campos principales:**

- `id uuid` como `challengeId` opaco.
- `operator_id uuid` nullable para mantener respuesta no enumerativa.
- `email_normalized_encrypted` o referencia resoluble protegida; `email_hash` para límites/deduplicación.
- `purpose text`, `status text` (`pending`, `delivery_requested`, `used`, `expired`, `blocked`, `delivery_failed`).
- `expires_at`, `resend_after`, `used_at`.
- `attempt_count`, `max_attempts`.
- `request_ip_hash`, `user_agent_hash`, `correlation_id`.
- `created_at`, `last_attempt_at`.
- `otp_hash` **solo** en la alternativa de autoridad propia; nunca guardar OTP en texto plano.

**PK:** `id`.

**Relaciones:** operador si existe, auditoría y entrega.

**Índices:** `email_hash, created_at desc`; `expires_at`; índice/unique parcial para un challenge activo por correo+purpose; `correlation_id`.

**Datos sensibles:** críticos. Debe vivir en esquema privado y no ser consultable desde React.

**Migración:** crear únicamente al implementar OTP. Si Supabase Auth cubre challenge, intentos y expiración suficientemente, reducir esta tabla a correlación/auditoría y no duplicar secretos.

### 4.18 `legacy_record_map` — temporal

**Propósito:** mapear IDs/filas de Sheets o n8n Tables a UUID Supabase y permitir reconciliación/rollback.

**Campos principales:** `id`, `source_system`, `source_table`, `source_record_id`, `target_table`, `target_id`, `source_checksum`, `migration_batch_id`, `migrated_at`, `last_verified_at`, `status`.

**PK:** `id`.

**Índices:** unique (`source_system`, `source_table`, `source_record_id`, `target_table`); `target_table, target_id`; `migration_batch_id`.

**Datos sensibles:** identificadores indirectos; no copiar payloads completos.

**Migración:** antes de importar cualquier entidad. Puede archivarse tras el periodo de estabilización, no eliminarse de inmediato.

## 5. Arquitectura de integración por fases

### Fase A — estado actual estabilizado

```text
React → servicios P1 → n8n → Sheets / n8n Tables
Firebase Auth → AuthContext neutral
```

- Mantener contratos actuales.
- Completar matriz de rutas/operaciones/permisos.
- Añadir IDs de correlación e idempotencia solo cuando n8n pueda aceptarlos sin romper contrato.
- Inventariar fuentes, campos, duplicados y volúmenes.
- Definir ambientes separados y datos anonimizados de prueba.
- No conectar React a Supabase todavía.

**Criterio de salida:** propietario de cada dato identificado, contratos documentados y plan de autorización de webhooks aprobado.

### Fase B — Supabase detrás de n8n

```text
React → n8n → legado (lectura principal)
             └→ Supabase (escritura sombra / tablas seleccionadas)
```

- Empezar por operadores/roles y `audit_log`.
- Introducir pagos en modo sombra: la operación actual sigue siendo la fuente oficial y n8n replica a Supabase con un ID idempotente.
- Ejecutar reconciliación automática de conteos, importes, periodos y checksums.
- No leer desde Supabase hasta alcanzar paridad acordada.
- Evitar dual-write sin outbox/idempotencia: si una escritura falla, debe quedar estado reintentable y auditable.
- Las secret/service-role keys viven solo en credenciales server-side de n8n o backend; nunca en `VITE_*`.

**Criterio de salida:** periodo de paridad sin diferencias críticas, rollback probado y auditoría suficiente para explicar cada operación.

### Fase C — Supabase como fuente principal

```text
React → n8n/API de negocio → Supabase Postgres/Storage
                         └→ Sheets/reportes (derivados, opcionales)
```

- Cambiar una entidad a la vez, con ventana y rollback.
- Supabase se vuelve la fuente autoritativa; Sheets deja de aceptar escrituras directas para esa entidad.
- Exportaciones a Sheets son proyecciones/reportes, no una segunda verdad.
- Eliminar `row_number` del modelo interno cuando ya no sea necesario; mantener adaptadores durante transición.
- Archivar o eliminar n8n Tables únicamente después del periodo de retención aprobado.

**Criterio de salida:** operaciones, conciliación, backups/restauración y observabilidad aprobados por módulo.

### Fase D — evaluar acceso directo desde React

El acceso directo no es una meta obligatoria. Debe decidirse caso por caso:

**Candidatos posibles:** perfil propio, catálogos no sensibles, lecturas limitadas o dashboard agregado.

**Mantener detrás de n8n/backend:** cobros, reversión/borrado, documentos, datos médicos, administración de roles, auditoría y flujos con efectos múltiples.

Si React usa Supabase directamente:

- Solo publishable key en el navegador.
- RLS habilitada y probada para cada operación.
- Policies por identidad/permiso, no solo por “usuario autenticado”.
- Nunca service-role/secret key en React.
- Mutaciones sensibles siguen pasando por una frontera server-side aunque exista RLS.

Supabase documenta que RLS debe habilitarse en tablas de esquemas expuestos y que una service-role key omite RLS. Por eso, si n8n usa service role, n8n/backend debe aplicar autorización de negocio explícita; RLS no protegerá una operación que llegue con esa credencial.

## 6. Contrato propuesto para OTP

### 6.1 Responsabilidades

| Componente | Responsabilidad | No debe hacer |
|---|---|---|
| React | Capturar correo/código, mostrar estados, conservar `challengeId`, consumir sesión normalizada | Generar/validar OTP, enviar correo, guardar secretos o decidir autorización |
| Auth Controller | Normalizar correo, aplicar límites, crear challenge fachada, pedir OTP a la autoridad, verificar y devolver sesión | Exponer claves de Supabase/n8n o filtrar si el correo existe |
| Supabase Auth | Generar/verificar OTP y emitir/renovar/revocar sesión en la opción recomendada | Delegar verificación al navegador |
| Adaptador de entrega | Verificar el evento de Auth, minimizar payload, firmar y llamar a n8n | Registrar OTP de forma persistente |
| n8n | Orquestar el envío con el proveedor configurado por el dueño | Ser autoridad de sesión salvo decisión explícita; aceptar webhook sin protección |
| Proveedor de correo | Entregar el mensaje | Conocer roles, pagos u otros datos de negocio |

### 6.2 Solicitud de OTP

Endpoint conceptual:

```http
POST /auth/otp/request
Content-Type: application/json
```

Request:

```json
{
  "email": "operador@ejemplo.mx",
  "purpose": "login"
}
```

Reglas backend:

- Validar sintaxis y aplicar una normalización definida. Como base: trim y lowercase; no aplicar reglas específicas de Gmail ni reescribir el local-part sin una política aprobada.
- Generar `challengeId` UUID/aleatorio opaco incluso para respuestas genéricas.
- Comprobar rate limits por IP, hash de correo, dispositivo/challenge y global.
- Solo operadores activos deben obtener una sesión, pero la respuesta de solicitud no revela si el correo existe.
- En la opción Supabase Auth, usar un flujo que no cree usuarios automáticamente.
- Crear/actualizar la correlación de challenge antes de pedir el envío.
- No devolver el OTP, hash, estado del usuario ni datos de rol.

Respuesta pública recomendada, siempre genérica:

```http
202 Accepted
```

```json
{
  "ok": true,
  "challengeId": "0d4f8c56-...",
  "expiresAt": "2026-06-28T18:10:00Z",
  "resendAfter": "2026-06-28T18:01:00Z",
  "message": "Si el correo está autorizado, recibirás un código en breve."
}
```

`expiresAt` y `resendAfter` deben ser coherentes con la configuración real de la autoridad OTP. Supabase aplica límites propios, pero la fachada necesita límites adicionales por challenge/correo y protección operativa.

### 6.3 Contrato interno de envío hacia n8n

URL futura: variable server-side como `N8N_OTP_EMAIL_WEBHOOK_URL`. **No usar prefijo `VITE_`, no hardcodear y no enviarla al navegador.**

Request sugerido:

```http
POST <N8N_OTP_EMAIL_WEBHOOK_URL>
Content-Type: application/json
X-PDMU-Request-Id: <correlation-id>
X-PDMU-Timestamp: <unix-seconds>
X-PDMU-Signature: v1=<hmac-sha256>
```

```json
{
  "to": "operador@ejemplo.mx",
  "otp": "123456",
  "challengeId": "0d4f8c56-...",
  "expiresAt": "2026-06-28T18:10:00Z",
  "purpose": "login",
  "template": "pdmu-operator-login-otp-v1",
  "metadata": {
    "locale": "es-MX",
    "correlationId": "req_..."
  }
}
```

Reglas del contrato:

- `metadata` mínima; no enviar rol, UID, existencia de cuenta ni datos administrativos.
- HTTPS obligatorio.
- Firmar el cuerpo crudo con secreto almacenado solo en backend/n8n; validar timestamp y tolerancia para evitar replay.
- Alternativas complementarias: allowlist de origen, mTLS o gateway privado según hosting.
- Rotar el secreto y versionar la firma.
- n8n debe responder rápido con aceptación y procesar/reintentar entrega de forma controlada.
- El dueño del proyecto define y configura el proveedor de correo dentro de n8n. Codex no crea ni modifica ese workflow en esta fase.

Respuesta interna sugerida:

```http
202 Accepted
```

```json
{
  "accepted": true,
  "deliveryId": "delivery_..."
}
```

La entrega fallida debe registrarse internamente sin cambiar la respuesta pública de forma que permita enumerar operadores. El OTP necesariamente llega en texto al componente que crea el correo; por ello n8n y su adaptador deben evitar guardar payloads completos en execution logs, errores o historiales más tiempo del indispensable.

### 6.4 Captura y reenvío

React conserva solo `challengeId`, expiración visual y cooldown. Puede mostrar el correo enmascarado calculado desde la entrada local, nunca recuperado del backend.

Reenvío conceptual:

```http
POST /auth/otp/resend
```

```json
{ "challengeId": "0d4f8c56-..." }
```

Respuesta: la misma forma genérica de solicitud, con nuevo `expiresAt`/`resendAfter`. La política debe decidir si invalida el código anterior; se recomienda un solo challenge/código activo por correo y purpose.

### 6.5 Verificación de OTP

Endpoint conceptual:

```http
POST /auth/otp/verify
Content-Type: application/json
```

```json
{
  "challengeId": "0d4f8c56-...",
  "otp": "123456"
}
```

Reglas backend:

- Validar formato antes de consultar.
- Resolver internamente el correo/operador; React no lo vuelve a declarar.
- Comprobar estado, expiración, intentos, cooldown y purpose.
- Pedir a Supabase Auth verificar el OTP en la opción recomendada.
- Marcar challenge usado de forma atómica antes de aceptar reutilización.
- Emitir sesión únicamente para operador activo/autorizado.
- Registrar auditoría sin OTP ni token.

Respuesta exitosa conceptual:

```json
{
  "ok": true,
  "identity": {
    "uid": "supabase-user-uuid",
    "email": "operador@ejemplo.mx",
    "displayName": "Operador PDMU",
    "provider": "supabase-otp"
  },
  "authorization": {
    "roles": ["<rol-aprobado>"],
    "permissions": ["<permiso-aprobado>"]
  },
  "session": {
    "expiresAt": "2026-06-28T19:00:00Z"
  }
}
```

El token puede viajar de dos maneras, a decidir con el hosting:

1. **Preferida si hay dominio/backend compatible:** refresh/session cookie `HttpOnly`, `Secure`, `SameSite` apropiado; el body no devuelve refresh token.
2. **SPA con bearer:** access token de vida corta en memoria y mecanismo de refresh protegido. Evitar refresh token duradero en `localStorage` por exposición a XSS.

La respuesta que consume `AuthContext` debe normalizarse al contrato vigente:

```js
{
  uid,
  email,
  displayName,
  provider: "supabase-otp"
}
```

Roles/permisos pueden añadirse como campos neutrales después de aprobar el modelo. `RequireAuth` solo debe comprobar sesión; un guard adicional como `RequirePermission` podrá controlar UI, sin sustituir autorización backend/RLS.

### 6.6 Errores estables de verificación

| HTTP | Código | Uso |
|---:|---|---|
| 400 | `OTP_MALFORMED` | Formato de challenge/código inválido. |
| 401 | `OTP_INVALID` | Código no válido. |
| 410 | `OTP_EXPIRED` | Challenge expirado. |
| 410 | `OTP_ALREADY_USED` | Challenge consumido. |
| 429 | `OTP_TOO_MANY_ATTEMPTS` | Challenge bloqueado por intentos. |
| 429 | `OTP_RATE_LIMITED` | Demasiadas solicitudes/reenvíos. |
| 403 | `OPERATOR_NOT_AUTHORIZED` | Identidad válida pero sin acceso; revisar si el mensaje de UI debe ser genérico. |
| 503 | `OTP_DELIVERY_UNAVAILABLE` | Servicio temporalmente no disponible; no revelar existencia de correo. |

Los mensajes de solicitud permanecen genéricos. Los errores de verificación pueden ser más específicos porque requieren un `challengeId` aleatorio, pero no deben incluir correo, estado interno ni contadores exactos útiles para atacar.

### 6.7 Parámetros iniciales sugeridos, sujetos a aprobación

- Código numérico de 6 a 8 dígitos según la configuración efectiva de la autoridad; el frontend no debe fijarlo a seis.
- Expiración: 5–10 minutos.
- Reenvío: no antes de 60 segundos.
- Máximo: 5 intentos por challenge.
- Un solo uso y un solo challenge activo por correo+purpose.
- Límites combinados por IP, hash de correo, challenge y sistema.
- Bloqueo progresivo y alertas ante picos.

Estos valores no se implementan aquí. Deben alinearse con la configuración efectiva de Supabase Auth y el riesgo operativo.

## 7. Compatibilidad con P0/P1

### `AuthContext`

**Ya preparado:** expone `authStatus`, `session`, `login`, `logout` y `getAccessToken`; las pantallas no reciben `FirebaseUser`.

**Cambio futuro:** sustituir llamadas del adaptador Firebase por un `supabaseOtpAuthAdapter` o `otpAuthAdapter`; añadir `requestOtp`, `verifyOtp` y `resendOtp` sin cambiar la semántica de sesión. Decidir persistencia/refresh antes de codificar.

### Adaptador Firebase

**Ya preparado:** toda dependencia de Firebase vive en `src/services/auth/firebaseAuth.js`.

**Cambio futuro:** convivir temporalmente mediante selección de provider/feature flag para piloto; luego retirar Firebase solo después de vincular identidades y cerrar sesiones antiguas. No borrar `legacy_firebase_uid`/mapeos hasta acabar conciliación.

### `RequireAuth`

**Ya preparado:** depende de sesión neutral, no de Firebase.

**Cambio futuro:** ninguno para autenticación básica. Crear autorización por permiso separada cuando existan roles reales; no inflar `RequireAuth` con reglas por módulo.

### Login

**Ya preparado:** consume `useAuth` y devuelve al usuario a la ruta solicitada.

**Cambio futuro:** UI de dos pasos correo → código, cooldown/reenvío, expiración, bloqueo y errores estables. No llamar directamente al webhook de correo.

### Servicios de workflows

**Ya preparado:** existe un cliente HTTP único, un punto `setAccessTokenProvider` desactivado y servicios por dominio.

**Cambio futuro:** conectar el token de sesión cuando n8n/backend lo valide; habilitar credencial por endpoint; manejar 401/403 y refresh una sola vez. Las URL n8n actuales no deben considerarse autorización.

### Panel administrativo

**Ya preparado:** ruta autenticada y llamadas centralizadas.

**Pendiente:** permisos reales por lectura/edición/borrado; auditoría de acceso; controles backend. Ocultar botones por rol es UX, no seguridad.

### Pagos

**Ya preparado:** adaptador propio y payload n8n aislado.

**Pendiente:** identidad del operador, idempotencia, reversión/auditoría, modelo mensual/transacción/asignación y conciliación antes de cutover.

### Asistencias

**Ya preparado:** captura manual/QR usa un mismo servicio y rutas protegidas.

**Pendiente:** evento explícito, idempotencia, operador, autorización y funcionamiento con mala conectividad.

### Inscripciones/documentos

**Ya preparado:** FormData y documentos pasan por un servicio de elementos.

**Pendiente:** esquema de datos, privacidad, validación de archivos, Storage privado, URLs firmadas, retención y permisos de lectura.

## 8. Seguridad recomendada

### Sesión y tokens

- Supabase Auth o una autoridad única debe firmar tokens; n8n no debe confiar en claims sin verificar firma, issuer, audience, expiración y revocación aplicable.
- Access token corto; refresh protegido. No registrar tokens.
- Rotación de claves y procedimiento de invalidación.
- El `provider` de `AuthContext` es informativo, no autorización.
- Definir conducta uniforme ante 401/403 en `httpClient` antes de activar credenciales.

### Roles y permisos

- Separar rol Supabase `authenticated` de roles PDMU.
- Fuente autoritativa en tablas `roles/permissions`, con auditoría.
- Si se incluyen claims en JWT, usar metadata controlada por servidor; no confiar en metadata modificable por el usuario.
- Tokens con permisos pueden quedar obsoletos: usar expiración breve y comprobar server-side las acciones críticas.
- Aplicar least privilege y separación de funciones para cobros/borrados.

### RLS y n8n

- RLS en toda tabla expuesta; policies por operación.
- Probar policies como anon, authenticated, cada rol y casos negativos.
- Service-role key solo en backend/n8n. Como omite RLS, el workflow debe verificar la identidad y permiso antes de ejecutar.
- Para funciones `security definer`, esquema privado, `search_path` fijo y revisión específica.

### OTP

- Respuesta no enumerativa, rate limits combinados, expiración, un solo uso y máximo de intentos.
- OTP en texto solo durante entrega; nunca en React logs, DB, auditoría o historial n8n.
- Hash/HMAC con pepper server-side si el sistema es propio; comparación constante.
- Invalidar challenges anteriores según política y auditar sin secretos.
- Proteger el webhook de correo con firma+timestamp/allowlist y limitar replay.

### Datos personales

- Clasificar columnas y definir quién puede leer cada una.
- Minimización: no copiar datos personales a logs, metadata de correo o reportes si no es necesario.
- Cifrado de secretos y campos especialmente sensibles donde proceda.
- Retención, rectificación, exportación y borrado definidos con el responsable del proyecto.
- Backups, restauración, región y acceso de soporte aprobados antes de migrar producción.

### Documentos

- Bucket privado; nunca URLs públicas permanentes.
- Signed URLs cortas emitidas tras autorización.
- Validar extensión, MIME real, tamaño y contenido; checksum y análisis antimalware.
- Nombres de objeto opacos, sin CURP/nombre en path.
- Service key fuera del navegador; políticas de Storage probadas.
- Reemplazo/versionado y borrado auditado según retención.

### Variables y webhooks

- `VITE_SUPABASE_URL` y una publishable key pueden estar en navegador si se decide acceso directo con RLS; secret/service-role keys nunca.
- `VITE_N8N_*` siguen siendo públicas y no son secretos.
- URL secreta por oscuridad no es control de acceso.
- Credenciales de Supabase, firma n8n, SMTP y OTP delivery solo en secretos server-side.

### Auditoría

- Correlation ID desde React/backend hasta n8n/Supabase.
- Registrar actor, permiso evaluado, entidad, resultado y tiempo.
- Append-only, acceso restringido y retención definida.
- Redactar before/after; no almacenar secretos, OTP, token o binarios.
- Alertas para borrados, reversión de pagos, cambios de rol y fallos OTP anómalos.

## 9. Plan de migración sugerido

### Paso 0 — decisiones y ambiente

- Aprobar arquitectura OTP (Supabase Auth recomendada vs propia).
- Definir dominio/hosting y estrategia cookie/bearer.
- Crear matriz operador → rol → permiso → operación.
- Separar proyecto/ambiente de desarrollo y producción.
- Inventariar datos, tamaños, duplicados, `row_number` e IDs.
- Definir backup, rollback, retención y responsables.

### Paso 1 — operadores, identidades y roles

- Diseñar migraciones SQL versionadas, aún sin conectar React.
- Crear operadores preautorizados y vínculo Firebase en ambiente de prueba.
- Crear roles/permisos aprobados y pruebas negativas de RLS.
- Pilotar Supabase Auth OTP con cuentas de prueba y Send Email Hook simulado, sin n8n productivo.
- No retirar Firebase.

### Paso 2 — auditoría

- Activar `audit_log` antes de mover datos financieros.
- Definir correlation IDs entre frontend, n8n y Supabase.
- Probar que logs no contienen OTP, tokens ni documentos.
- Probar consultas y alertas de auditoría.

### Paso 3 — pagos/mensualidades

- Limpiar y mapear periodos/importes/IDs.
- Crear `monthly_dues`, `payment_transactions` y, si aplica, allocations.
- Shadow-write idempotente desde n8n.
- Conciliar suma total, conteos por periodo/elemento y reversos.
- Ejecutar piloto y rollback.
- Hacer Supabase fuente principal solo tras aprobación financiera.

### Paso 4 — asistencias

- Resolver modelo de eventos y deduplicación.
- Shadow-write con idempotency key.
- Conciliar conteos por evento/día/estado.
- Probar QR, manual, doble envío y mala red.
- Cambiar fuente de lectura después de paridad.

### Paso 5 — inscripciones y tutores

- Deduplicar elementos/tutores y conservar IDs legacy.
- Clasificar datos médicos y acceso.
- Migrar primero metadatos sin archivos.
- Conciliar relaciones y estados.

### Paso 6 — documentos

- Aprobar bucket/policies/retención/antimalware.
- Copiar por lotes con checksum y manifiesto.
- Verificar legibilidad y permisos; no borrar origen todavía.
- Cambiar entrega a signed URLs.
- Retirar origen solo después de retención y aprobación.

### Paso 7 — cutover OTP y retiro de Firebase

- Piloto con pocos operadores y feature flag.
- Vincular identidad Supabase al mismo `operator_id`.
- Verificar sesiones, logout, refresh, roles y 401/403.
- Migrar grupos de operadores y observar fallos.
- Deshabilitar login Firebase después del periodo acordado.
- Revocar credenciales/sesiones antiguas y conservar mapeo auditado.

### Paso 8 — evaluar acceso directo React → Supabase

- Solo después de estabilizar Supabase como fuente principal.
- Elegir casos de bajo riesgo.
- Escribir pruebas RLS y threat model antes de habilitar.
- Mantener operaciones sensibles detrás de backend/n8n salvo justificación formal.

## 10. Estrategia de conciliación y rollback

- Cada migración tiene `migration_batch_id` y manifiesto de origen.
- Reconciliar conteos, sumas, nulos, duplicados y checksums; no solo número de filas.
- Dual-write con idempotency key y estado `pending/succeeded/failed`, nunca “fire and forget”.
- En Fase B, el legado sigue siendo autoritativo; una falla Supabase no debe producir un cobro duplicado al reintentar.
- Antes del cutover, congelar o controlar escrituras directas fuera de n8n.
- Rollback por módulo: regresar lectura/escritura al origen anterior sin perder operaciones registradas durante la ventana.
- Mantener exportación verificable y restauración ensayada.

## 11. Riesgos principales

| Riesgo | Severidad | Mitigación |
|---|---:|---|
| Service-role de Supabase expuesta o usada desde React | Crítica | Secretos solo server-side, rotación y revisión de bundles/logs. |
| n8n con service role omite RLS | Crítica | Autorización explícita en frontera backend, credenciales mínimas y auditoría. |
| OTP/webhook invocable libremente | Crítica | Firma, timestamp, rate limit, allowlist y respuesta no enumerativa. |
| OTP registrado en execution logs de n8n | Crítica | Redacción/no persistencia y retención mínima del workflow de entrega. |
| Dos autoridades de sesión (custom + Supabase) | Alta | Elegir una; preferir Supabase Auth y fachada. |
| Dual-write produce divergencia financiera | Alta | Idempotencia, estado reintentable, conciliación y cutover por módulo. |
| Claims de rol obsoletos o manipulables | Alta | Metadata server-side, token corto y verificación de DB en acciones críticas. |
| Documentos quedan públicos | Alta | Bucket privado, RLS, signed URLs, pruebas negativas y sin service key cliente. |
| Auto-creación de usuarios OTP | Alta | Operadores preprovisionados y signup deshabilitado para login interno. |
| Migrar `row_number` como identidad estable | Alta | UUID + `legacy_record_map`; `row_number` solo como referencia temporal. |
| Historial financiero borrable | Alta | Transacciones append/reversión y auditoría; sin cascade/hard delete. |
| Acceso directo React habilitado antes de RLS completa | Alta | Mantener n8n/backend hasta threat model y pruebas. |
| Challenge facade no correlaciona bien con Auth Hook | Media/Alta | Spike técnico no productivo antes de decidir arquitectura. |

## 12. Decisiones pendientes del dueño

### Identidad y OTP

1. ¿Supabase Auth será la autoridad de sesión o existe una razón para sesión propia?
2. ¿Los operadores serán siempre preautorizados? Se recomienda que sí y no auto-crear por OTP.
3. ¿Qué dominio alojará React y la fachada? Esto define cookies, CORS y refresh.
4. ¿Qué proveedor de correo configurará el dueño en n8n y qué retención de ejecuciones tendrá?
5. ¿El Send Email Hook podrá llegar a n8n directamente con validación de firma, o se requiere adaptador intermedio?
6. ¿Cuánto deben durar código, sesión y cooldown?

### Autorización

7. ¿Cuáles son los roles reales y qué operaciones puede ejecutar cada uno?
8. ¿Quién puede borrar/revertir pagos, borrar asistencias, ver documentos o cambiar roles?
9. ¿Se requiere doble aprobación para operaciones financieras o eliminación de elementos?
10. ¿Habrá varias zonas/unidades que deban aislar datos?

### Datos

11. ¿Cuál es hoy la fuente oficial exacta por entidad: Sheets o n8n Tables?
12. ¿`ID` y `ID Pago` son estables y únicos? ¿Puede cambiar `row_number`?
13. ¿Mensualidad admite pagos parciales, múltiples meses, becas, recargos o reversión?
14. ¿Cada asistencia pertenece a un evento explícito?
15. ¿Qué datos/documentos deben retenerse, por cuánto tiempo y quién puede consultarlos?

### Operación

16. ¿RPO/RTO, región, backup y restauración requeridos?
17. ¿Qué ambiente y dataset anonimizados se usarán para pruebas?
18. ¿Cuánto tiempo deben convivir Firebase, legado y Supabase?
19. ¿Qué métricas definen paridad y éxito por módulo?
20. ¿Se necesita acceso directo React → Supabase o es aceptable mantener n8n como backend permanente?

## 13. Qué implementar primero y qué posponer

### Primero

1. ADR: elegir Supabase Auth + fachada + Send Email Hook como hipótesis y validar con spike no productivo.
2. Matriz de roles/permisos y catálogo de operaciones actuales.
3. Modelo versionado de `operators`, identidades, roles y auditoría.
4. Threat model de OTP, n8n, service role, cookies/tokens y Storage.
5. Contratos `/auth/otp/request`, `/verify`, `/resend` y webhook n8n aprobados por el dueño.
6. Estrategia de IDs, idempotencia, conciliación y rollback.

### Posponer

- Cambiar la pantalla de login o retirar Firebase.
- Conectar React directamente a Supabase DB/Storage.
- Crear una autoridad OTP propia.
- Migrar documentos antes de policies/retención/escaneo.
- Migrar todos los módulos en una ventana única.
- Eliminar Sheets/n8n Tables antes de conciliación y retención.
- Poner roles inventados en producción.
- Activar tokens en los workflows antes de que el receptor los valide.

## 14. Criterios de salida de la fase de diseño

Antes de comenzar implementación deben existir:

- Decisión firmada sobre autoridad OTP/sesión.
- Matriz de permisos aprobada.
- Contratos de auth y entrega n8n versionados.
- Decisión de hosting/cookies/CORS.
- Esquema inicial de operadores/auditoría revisado.
- Plan de secretos, RLS y prueba negativa.
- Plan de migración/conciliación/rollback por módulo.
- Responsable del workflow y proveedor de correo identificado.

## 15. Referencias oficiales consultadas

- [Supabase Auth: passwordless email logins](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Supabase Auth: Send Email Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook)
- [Supabase Auth: rate limits](https://supabase.com/docs/guides/auth/rate-limits)
- [Supabase Auth: Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook)
- [Supabase Database: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase: securing your data and key handling](https://supabase.com/docs/guides/database/secure-data)
- [Supabase Storage: access control](https://supabase.com/docs/guides/storage/security/access-control)

Estas referencias respaldan capacidades de plataforma, no sustituyen la prueba técnica ni las decisiones del dueño sobre n8n, correo, retención y autorización.

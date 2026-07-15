# Frontend + Supabase directo v1

Estado: capa SQL preparada; React todavía no está conectado a datos de negocio.
Migración: `supabase/migrations/202606290002_frontend_direct_access_v1.sql`.
Validación: `supabase/validation/validate_frontend_direct_access_v1.sql`.

## Decisión

La primera versión funcional usará Supabase Auth, PostgREST/RPC y RLS directamente desde React. Esto reduce piezas operativas mientras se valida el producto y conserva la autorización dentro de PostgreSQL, junto a los datos.

Esta decisión reemplaza para esta fase la arquitectura descrita en los documentos n8n v2. n8n no se modifica ni participa en búsquedas, expedientes, pagos o asistencias. Tampoco se vuelve a Google Sheets: Supabase es la fuente de datos de negocio.

La publishable key identifica el proyecto, pero no autoriza por sí sola. Cada operación requiere una sesión Supabase válida y un registro en `operator_profiles` cuyo `id = auth.uid()` y cuyo `status = 'active'`.

## Frontera de acceso

### RLS directo

| Recurso | Operador activo | Admin activo |
|---|---|---|
| `operator_profiles` | Lee su perfil | Lee perfiles |
| `elements` | Lee elementos activos | Lee todos; inserta y actualiza |
| `element_documents` | Lee metadata activa de elementos activos | Lee toda; inserta y actualiza metadata |
| `payments` | Lee | Lee |
| `attendance_records` | Lee | Lee |
| `audit_log` | Sin acceso | Solo lectura |
| `idempotency_keys` | Sin acceso | Sin acceso directo |
| `payment_fee_schedule` | Sin acceso | Sin acceso directo desde React |

No existe policy ni privilegio `DELETE` para tablas de negocio. La cancelación es lógica. `audit_log` sigue siendo append-only por trigger y el cliente no puede insertar entradas libremente.

### RPC

| RPC | Autorización | Estado |
|---|---|---|
| `search_elements` | Operador activo | Lista mínima, búsqueda server-side |
| `get_element` | Operador activo | Expediente y metadata documental; no expone IDs/URLs Drive |
| `create_element` | Operador activo | Código, UUID, timestamps, versión y auditoría server-side |
| `record_payment` | Operador activo | Monto y moneda desde tarifa server-side; idempotente |
| `list_payments` | Operador activo | Historial por elemento y año opcional |
| `record_attendance` | Operador activo | Timestamp server-side; idempotente |
| `list_attendance` | Operador activo | Historial con rango máximo de 366 días |
| `cancel_payment` | Admin activo | Cancelación lógica, versión esperada y auditoría |
| `cancel_attendance` | Admin activo | Cancelación lógica, versión esperada y auditoría |

Las escrituras requieren `p_request_id`; React deberá generar un UUID por intención y reutilizarlo únicamente al reintentar la misma solicitud. Una clave usada por otro actor, acción o payload produce `IDEMPOTENCY_CONFLICT`.

## Montos de pagos

React nunca envía `amount_cents` ni `currency` a `record_payment`. La RPC consulta `payment_fee_schedule` por año y mes. No se incluyó una tarifa inventada en la migración: antes de registrar pagos se debe cargar la política aprobada desde SQL Editor o desde una herramienta administrativa futura.

Ejemplo deliberadamente parametrizado:

```sql
insert into public.payment_fee_schedule (year, month, amount_cents, currency, status)
values (<YEAR>, <MONTH_1_TO_12>, <APPROVED_AMOUNT_CENTS>, 'MXN', 'active')
on conflict (year, month) do update
set amount_cents = excluded.amount_cents,
    currency = excluded.currency,
    status = excluded.status;
```

Sin una fila activa para el periodo, la RPC devuelve `PAYMENT_POLICY_UNAVAILABLE` y no registra el pago.

## Variables de React

Cuando se conecte la capa de datos, React reutilizará las variables que ya usa el login OTP:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Ambas variables son visibles en el bundle del navegador. La seguridad depende de Auth + RLS/RPC, no de ocultar la publishable key.

Nunca deben llegar al frontend:

- `service_role` o una secret key de Supabase;
- contraseña o URL directa de PostgreSQL;
- secretos de n8n, Google o Drive;
- JWT de otros usuarios, OTP, refresh tokens ajenos;
- IDs internos de Drive cuando no sean necesarios.

## Primer operador admin

1. Crear o autenticar el usuario mediante el flujo OTP existente de Supabase Auth.
2. Copiar su UUID desde **Authentication > Users**.
3. Abrir `supabase/seed/create_first_admin_template.sql`.
4. Sustituir los tres placeholders localmente y ejecutar el `insert` en SQL Editor.
5. No guardar ni commitear los valores reales.

Plantilla:

```sql
insert into public.operator_profiles (
  id,
  email,
  display_name,
  role,
  status
)
values (
  '<AUTH_USER_ID>',
  '<EMAIL>',
  '<DISPLAY_NAME>',
  'admin',
  'active'
);
```

El UUID debe existir previamente en `auth.users`; la FK rechaza IDs inventados.

## Aplicación y prueba en SQL Editor

Aplicar en este orden sobre un proyecto de desarrollo o con respaldo verificado:

1. `supabase/migrations/202606290002_frontend_direct_access_v1.sql`.
2. `supabase/validation/validate_frontend_direct_access_v1.sql`.
3. Crear el primer admin con la plantilla anterior.
4. Cargar al menos una tarifa aprobada antes de probar pagos.

La validación debe terminar con:

```text
validation_status | PASS
```

Para simular una sesión en SQL Editor, usar una transacción y reemplazar el UUID por el de un operador de prueba existente:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<AUTH_USER_ID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select public.is_active_operator();
select public.current_operator_role();
select public.search_elements('PDMU', 20, 'active');

rollback;
```

Las pruebas de escritura deben ejecutarse también dentro de `begin`/`rollback`, usando un `p_request_id` nuevo. Para probar replay idempotente se necesita `commit`: repetir exactamente el mismo payload y request ID debe devolver la respuesta guardada; cambiar el payload debe fallar.

También se deben verificar por separado:

- un usuario Auth sin `operator_profiles` recibe `ACTIVE_OPERATOR_REQUIRED`;
- un perfil `inactive` no puede leer ni ejecutar RPC operativas;
- un operador no puede consultar `audit_log`;
- solo admin puede cancelar;
- `anon` no puede leer tablas ni ejecutar RPC;
- un periodo sin tarifa no crea pagos;
- un segundo pago activo del mismo elemento/periodo se rechaza.

## Reversión

La migración es transaccional: si falla antes del `commit`, PostgreSQL revierte todo automáticamente. Después del `commit`, la reversión debe hacerse primero en un proyecto de desarrollo y con respaldo.

Orden de reversión manual:

1. Revocar `EXECUTE` de las RPC a `authenticated` para detener nuevas escrituras.
2. Retirar grants directos de `authenticated`.
3. Eliminar las policies creadas por esta migración.
4. Eliminar las RPC y helpers internos/públicos.
5. Eliminar `payment_fee_schedule` solo después de exportar o confirmar que sus datos pueden descartarse.
6. Restaurar el estado cerrado de v1: RLS activo, sin policies y sin privilegios para `anon`/`authenticated`.

No se recomienda improvisar un rollback en producción: las tablas `elements`, `payments`, `attendance_records` y `audit_log` pueden contener datos creados después de habilitar esta fase y no deben borrarse.

## Pendientes

- Conectar React gradualmente mediante un servicio Supabase de negocio sin alterar el cliente Auth OTP.
- Definir la regla semántica de asistencia duplicada (una marca diaria, ventanas o entrada/salida). La idempotencia actual solo cubre reintentos técnicos.
- Implementar corrección auditada de pagos y asistencias; v1 incluye registro, consulta y cancelación, no corrección general.
- Diseñar administración segura de tarifas; por ahora se cargan con SQL privilegiado.
- Definir catálogos definitivos de sexo, grupos, métodos y tipos documentales.
- Diseñar cargas/descargas documentales con Supabase Storage o URLs autorizadas; esta fase solo expone metadata.
- Agregar paginación por cursor. Las listas v1 tienen límites acotados.
- Revisar si `medical_notes` requiere un permiso más granular que operador activo.
- Integrar n8n después únicamente para automatizaciones que realmente lo ameriten (Drive, correo, conciliaciones o procesos largos), sin convertirlo de nuevo en requisito para la operación básica.

## Fuera de alcance de esta fase

- Cambios en componentes, rutas, login OTP o servicios React.
- Workflows, webhooks o credenciales n8n.
- Google Sheets como fuente operativa.
- Aprovisionamiento de Drive/QR.
- Borrado físico de datos de negocio.

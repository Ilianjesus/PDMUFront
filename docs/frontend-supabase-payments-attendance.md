# Frontend Supabase directo: pagos y asistencias

Esta fase conecta pagos y asistencias a Supabase directo cuando:

```env
VITE_USE_SUPABASE_BUSINESS=true
```

React sigue usando únicamente:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- la sesión de Supabase Auth OTP actual

Nunca debe usarse `service_role` en el frontend ni guardarse en el repo.

## RPCs usadas

Pagos:

- `record_payment(p_request_id, p_element_id, p_year, p_month, p_method, p_reference)`
- `list_payments(p_element_id, p_year, p_limit)`
- `cancel_payment(p_request_id, p_payment_id, p_expected_version, p_reason)`

Asistencias:

- `record_attendance(p_request_id, p_element_id, p_status, p_source)`
- `list_attendance(p_element_id, p_from, p_to, p_limit)`
- `cancel_attendance(p_request_id, p_attendance_id, p_expected_version, p_reason)`

Estas RPCs existen en `supabase/migrations/202606290002_frontend_direct_access_v1.sql`; no se creó migración 003 para esta fase.

## Pantallas conectadas

- `RegistrarPago`
  - Busca elementos con `search_elements`.
  - Registra una o varias mensualidades llamando `record_payment` por mes.
  - No envía monto autoritativo; Supabase calcula importe y moneda con `payment_fee_schedule`.

- `ModuloPagos`
  - Lista historial con `list_payments`.
  - En modo Supabase no edita montos ni periodos.
  - Cancela pagos con `cancel_payment`; la cancelación es lógica y requiere motivo.

- `RegistrarAsistencia`
  - Permite buscar/seleccionar elemento con `search_elements`.
  - También acepta UUID/código temporalmente.
  - Registra con `record_attendance`; el timestamp se genera en Supabase.

- `Scanner`
  - Procesa QR como texto plano o JSON simple.
  - Si el QR no contiene UUID, intenta resolverlo con `search_elements`.
  - Registra con `record_attendance` usando `source = 'qr'`.

- `ModuloAsistencias`
  - Lista historial con `list_attendance`.
  - No edita fechas/estados en modo Supabase.
  - Cancela asistencias con `cancel_attendance`; la cancelación es lógica y requiere motivo.

## Qué queda en legacy

Con `VITE_USE_SUPABASE_BUSINESS=false`, el flujo existente puede seguir usando workflows legacy si las variables n8n están configuradas.

Con `VITE_USE_SUPABASE_BUSINESS=true`, las operaciones principales de elementos, pagos y asistencias no dependen de n8n ni Google Sheets.

## Limitaciones conocidas

- `payment_fee_schedule` debe tener tarifa activa para cada año/mes antes de registrar pagos.
- Si se seleccionan varios meses y una mensualidad intermedia falla, las anteriores pueden quedar registradas. La UI muestra el error parcial.
- No hay edición general de pagos/asistencias desde React; se cancela el registro incorrecto y se captura uno nuevo.
- El scanner no tiene todavía contrato QR definitivo. Soporta UUID, código buscable o JSON con `elementId`, `element_id`, `ID`, `id` o `elementCode`.
- Documentos/Drive siguen pendientes.
- Dashboard sigue pendiente de migración Supabase.
- n8n queda fuera de esta vertical y se integrará después solo donde aporte valor.

## Rollback

Para volver temporalmente al comportamiento legacy:

```env
VITE_USE_SUPABASE_BUSINESS=false
```

Después reinicia Vite/build. No elimines las migraciones ni los datos de Supabase para hacer rollback visual.

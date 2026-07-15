-- Development-only fixtures for PDMU business schema v1.
-- Do not run in production.
-- operator_profiles is intentionally not seeded: its id must reference a real auth.users row.

begin;

insert into public.elements (
  id,
  element_code,
  given_names,
  paternal_surname,
  maternal_surname,
  birth_date,
  sex_code,
  group_code,
  medical_notes,
  guardian_name,
  guardian_phone,
  qr_value,
  drive_folder_id,
  drive_folder_url,
  status
)
values (
  '00000000-0000-4000-8000-000000000101',
  'PDMU-SEED-001',
  'Elemento',
  'Prueba',
  'Supabase',
  date '2010-04-17',
  'F',
  'SEED',
  null,
  'Tutor de Prueba',
  '5500000000',
  'PDMU-QR-SEED-001',
  'drive-folder-seed-001',
  'https://example.invalid/drive/folder/seed-001',
  'active'
)
on conflict do nothing;

insert into public.element_documents (
  id,
  element_id,
  document_type,
  drive_file_id,
  drive_url,
  original_filename,
  mime_type,
  size_bytes,
  status,
  version
)
values (
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000101',
  'birth_certificate',
  'drive-file-seed-001',
  'https://example.invalid/drive/file/seed-001',
  'acta-prueba.pdf',
  'application/pdf',
  1024,
  'active',
  1
)
on conflict do nothing;

insert into public.payments (
  id,
  payment_code,
  element_id,
  year,
  month,
  amount_cents,
  currency,
  method,
  reference,
  status,
  recorded_at
)
values (
  '00000000-0000-4000-8000-000000000301',
  'PAY-SEED-001',
  '00000000-0000-4000-8000-000000000101',
  2026,
  6,
  20000,
  'MXN',
  'cash',
  'SEED-REFERENCE',
  'posted',
  timestamptz '2026-06-29 12:00:00-06'
)
on conflict do nothing;

insert into public.attendance_records (
  id,
  attendance_code,
  element_id,
  occurred_at,
  status,
  source,
  record_status
)
values (
  '00000000-0000-4000-8000-000000000401',
  'ATT-SEED-001',
  '00000000-0000-4000-8000-000000000101',
  timestamptz '2026-06-29 08:30:00-06',
  'present',
  'manual',
  'active'
)
on conflict do nothing;

insert into public.audit_log (
  id,
  actor_user_id,
  action,
  entity_type,
  entity_id,
  before_data,
  after_data,
  reason,
  request_id
)
values (
  '00000000-0000-4000-8000-000000000501',
  null,
  'seed.element.created',
  'element',
  '00000000-0000-4000-8000-000000000101',
  null,
  jsonb_build_object('elementCode', 'PDMU-SEED-001', 'status', 'active'),
  'Development schema validation fixture',
  'req-seed-business-schema-v1'
)
on conflict do nothing;

insert into public.idempotency_keys (
  key,
  actor_user_id,
  action,
  request_hash,
  status,
  response_status,
  response,
  expires_at
)
values (
  'idem-seed-business-schema-v1',
  null,
  'seed.element.create',
  'sha256:development-fixture-not-a-real-request',
  'completed',
  201,
  jsonb_build_object('ok', true, 'fixture', true),
  now() + interval '1 day'
)
on conflict do nothing;

commit;

select
  'PASS' as seed_status,
  'PDMU-SEED-001 and related development fixtures are available' as detail;

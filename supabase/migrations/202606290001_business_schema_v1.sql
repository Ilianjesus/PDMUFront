begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at = now();
    new.updated_at = new.created_at;
  else
    new.created_at = old.created_at;
    new.updated_at = now();
  end if;

  return new;
end;
$$;

create or replace function public.enforce_created_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at = now();
  else
    new.created_at = old.created_at;
  end if;

  return new;
end;
$$;

create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log rows are append-only';
end;
$$;

create or replace function public.set_updated_at_and_increment_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at = now();
    new.updated_at = new.created_at;
    new.version = 1;
  else
    new.created_at = old.created_at;
    new.updated_at = now();
    new.version = old.version + 1;
  end if;

  return new;
end;
$$;

create or replace function public.set_attendance_date_and_update_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.attendance_date = (new.occurred_at at time zone 'America/Mexico_City')::date;

  if tg_op = 'INSERT' then
    new.created_at = now();
    new.updated_at = new.created_at;
    new.version = 1;
  else
    new.created_at = old.created_at;
    new.updated_at = now();
    new.version = old.version + 1;
  end if;

  return new;
end;
$$;

create table public.operator_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'operator',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operator_profiles_email_not_blank check (btrim(email) <> ''),
  constraint operator_profiles_role_check check (role in ('operator', 'admin')),
  constraint operator_profiles_status_check check (status in ('active', 'inactive'))
);

create unique index operator_profiles_email_lower_uidx
  on public.operator_profiles (lower(btrim(email)));

create index operator_profiles_role_status_idx
  on public.operator_profiles (role, status);

create trigger operator_profiles_set_updated_at
before insert or update on public.operator_profiles
for each row execute function public.set_updated_at();

create table public.elements (
  id uuid primary key default gen_random_uuid(),
  element_code text not null,
  given_names text not null,
  paternal_surname text not null,
  maternal_surname text,
  birth_date date not null,
  sex_code text not null,
  group_code text,
  medical_notes text,
  guardian_name text not null,
  guardian_phone text not null,
  qr_value text,
  drive_folder_id text,
  drive_folder_url text,
  status text not null default 'active',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint elements_code_not_blank check (btrim(element_code) <> ''),
  constraint elements_given_names_not_blank check (btrim(given_names) <> ''),
  constraint elements_paternal_surname_not_blank check (btrim(paternal_surname) <> ''),
  constraint elements_sex_code_not_blank check (btrim(sex_code) <> ''),
  constraint elements_guardian_name_not_blank check (btrim(guardian_name) <> ''),
  constraint elements_guardian_phone_not_blank check (btrim(guardian_phone) <> ''),
  constraint elements_status_check check (status in ('active', 'inactive', 'archived')),
  constraint elements_version_positive check (version >= 1)
);

create index elements_status_idx
  on public.elements (status);

create index elements_group_status_idx
  on public.elements (group_code, status);

create unique index elements_element_code_lower_uidx
  on public.elements (lower(btrim(element_code)));

create index elements_given_names_trgm_idx
  on public.elements using gin (given_names extensions.gin_trgm_ops);

create index elements_paternal_surname_trgm_idx
  on public.elements using gin (paternal_surname extensions.gin_trgm_ops);

create index elements_maternal_surname_trgm_idx
  on public.elements using gin (maternal_surname extensions.gin_trgm_ops);

create unique index elements_qr_value_uidx
  on public.elements (qr_value)
  where qr_value is not null;

create unique index elements_drive_folder_id_uidx
  on public.elements (drive_folder_id)
  where drive_folder_id is not null;

create trigger elements_set_updated_at
before insert or update on public.elements
for each row execute function public.set_updated_at_and_increment_version();

create table public.element_documents (
  id uuid primary key default gen_random_uuid(),
  element_id uuid not null references public.elements (id) on delete restrict,
  document_type text not null,
  drive_file_id text,
  drive_url text,
  original_filename text,
  mime_type text,
  size_bytes bigint,
  status text not null default 'active',
  version integer not null default 1,
  replaces_document_id uuid references public.element_documents (id) on delete set null,
  uploaded_at timestamptz not null default now(),
  replaced_at timestamptz,
  created_at timestamptz not null default now(),
  constraint element_documents_type_not_blank check (btrim(document_type) <> ''),
  constraint element_documents_size_nonnegative check (size_bytes is null or size_bytes >= 0),
  constraint element_documents_status_check check (status in ('active', 'replaced', 'cancelled')),
  constraint element_documents_version_positive check (version >= 1),
  constraint element_documents_replaced_at_check check (
    (status = 'replaced' and replaced_at is not null)
    or (status <> 'replaced' and replaced_at is null)
  )
);

create index element_documents_element_id_idx
  on public.element_documents (element_id);

create index element_documents_element_type_idx
  on public.element_documents (element_id, document_type);

create unique index element_documents_active_type_uidx
  on public.element_documents (element_id, document_type)
  where status = 'active';

create unique index element_documents_drive_file_id_uidx
  on public.element_documents (drive_file_id)
  where drive_file_id is not null;

create trigger element_documents_enforce_created_at
before insert or update on public.element_documents
for each row execute function public.enforce_created_at();

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  payment_code text not null,
  element_id uuid not null references public.elements (id) on delete restrict,
  year integer not null,
  month integer not null,
  amount_cents integer not null,
  currency text not null default 'MXN',
  method text not null,
  reference text,
  status text not null default 'posted',
  recorded_at timestamptz not null default now(),
  recorded_by uuid references public.operator_profiles (id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references public.operator_profiles (id) on delete set null,
  cancel_reason text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_code_not_blank check (btrim(payment_code) <> ''),
  constraint payments_year_check check (year between 2000 and 2100),
  constraint payments_month_check check (month between 1 and 12),
  constraint payments_amount_positive check (amount_cents > 0),
  constraint payments_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint payments_method_not_blank check (btrim(method) <> ''),
  constraint payments_status_check check (status in ('posted', 'cancelled')),
  constraint payments_version_positive check (version >= 1),
  constraint payments_cancellation_check check (
    (
      status = 'posted'
      and cancelled_at is null
      and cancelled_by is null
      and cancel_reason is null
    )
    or
    (
      status = 'cancelled'
      and cancelled_at is not null
      and nullif(btrim(cancel_reason), '') is not null
    )
  )
);

create unique index payments_active_period_uidx
  on public.payments (element_id, year, month)
  where status = 'posted';

create unique index payments_payment_code_lower_uidx
  on public.payments (lower(btrim(payment_code)));

create index payments_element_year_idx
  on public.payments (element_id, year, month);

create index payments_recorded_at_idx
  on public.payments (recorded_at desc);

create index payments_status_idx
  on public.payments (status);

create trigger payments_set_updated_at
before insert or update on public.payments
for each row execute function public.set_updated_at_and_increment_version();

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  attendance_code text not null,
  element_id uuid not null references public.elements (id) on delete restrict,
  occurred_at timestamptz not null,
  attendance_date date not null,
  status text not null,
  source text not null,
  record_status text not null default 'active',
  recorded_by uuid references public.operator_profiles (id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references public.operator_profiles (id) on delete set null,
  cancel_reason text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_code_not_blank check (btrim(attendance_code) <> ''),
  constraint attendance_status_check check (status in ('present', 'absent', 'late', 'excused')),
  constraint attendance_source_check check (source in ('manual', 'qr', 'legacy_import')),
  constraint attendance_record_status_check check (record_status in ('active', 'cancelled')),
  constraint attendance_version_positive check (version >= 1),
  constraint attendance_cancellation_check check (
    (
      record_status = 'active'
      and cancelled_at is null
      and cancelled_by is null
      and cancel_reason is null
    )
    or
    (
      record_status = 'cancelled'
      and cancelled_at is not null
      and nullif(btrim(cancel_reason), '') is not null
    )
  )
);

create index attendance_element_occurred_idx
  on public.attendance_records (element_id, occurred_at desc);

create unique index attendance_code_lower_uidx
  on public.attendance_records (lower(btrim(attendance_code)));

create index attendance_date_status_idx
  on public.attendance_records (attendance_date, status);

create index attendance_record_status_idx
  on public.attendance_records (record_status);

create trigger attendance_records_set_metadata
before insert or update on public.attendance_records
for each row execute function public.set_attendance_date_and_update_metadata();

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_data jsonb,
  after_data jsonb,
  reason text,
  request_id text,
  created_at timestamptz not null default now(),
  constraint audit_log_action_not_blank check (btrim(action) <> ''),
  constraint audit_log_entity_type_not_blank check (btrim(entity_type) <> ''),
  constraint audit_log_entity_id_not_blank check (btrim(entity_id) <> '')
);

create index audit_log_entity_idx
  on public.audit_log (entity_type, entity_id, created_at desc);

create index audit_log_actor_idx
  on public.audit_log (actor_user_id, created_at desc);

create index audit_log_request_id_idx
  on public.audit_log (request_id)
  where request_id is not null;

create index audit_log_created_at_idx
  on public.audit_log (created_at desc);

create trigger audit_log_enforce_created_at
before insert on public.audit_log
for each row execute function public.enforce_created_at();

create trigger audit_log_append_only
before update or delete on public.audit_log
for each row execute function public.prevent_audit_log_mutation();

create table public.idempotency_keys (
  key text primary key,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  request_hash text not null,
  status text not null default 'pending',
  response_status integer,
  response jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint idempotency_key_not_blank check (btrim(key) <> ''),
  constraint idempotency_action_not_blank check (btrim(action) <> ''),
  constraint idempotency_request_hash_not_blank check (btrim(request_hash) <> ''),
  constraint idempotency_status_check check (status in ('pending', 'completed', 'failed')),
  constraint idempotency_response_status_check check (
    response_status is null or response_status between 100 and 599
  ),
  constraint idempotency_expiration_check check (expires_at > created_at)
);

create index idempotency_keys_action_created_idx
  on public.idempotency_keys (action, created_at desc);

create index idempotency_keys_expires_at_idx
  on public.idempotency_keys (expires_at);

create trigger idempotency_keys_enforce_created_at
before insert or update on public.idempotency_keys
for each row execute function public.enforce_created_at();

alter table public.operator_profiles enable row level security;
alter table public.elements enable row level security;
alter table public.element_documents enable row level security;
alter table public.payments enable row level security;
alter table public.attendance_records enable row level security;
alter table public.audit_log enable row level security;
alter table public.idempotency_keys enable row level security;

revoke all on table public.operator_profiles from anon, authenticated;
revoke all on table public.elements from anon, authenticated;
revoke all on table public.element_documents from anon, authenticated;
revoke all on table public.payments from anon, authenticated;
revoke all on table public.attendance_records from anon, authenticated;
revoke all on table public.audit_log from anon, authenticated;
revoke all on table public.idempotency_keys from anon, authenticated;

revoke all on table public.operator_profiles from service_role;
revoke all on table public.elements from service_role;
revoke all on table public.element_documents from service_role;
revoke all on table public.payments from service_role;
revoke all on table public.attendance_records from service_role;
revoke all on table public.audit_log from service_role;
revoke all on table public.idempotency_keys from service_role;

grant select, insert, update on table public.operator_profiles to service_role;
grant select, insert, update on table public.elements to service_role;
grant select, insert, update on table public.element_documents to service_role;
grant select, insert, update on table public.payments to service_role;
grant select, insert, update on table public.attendance_records to service_role;
grant select, insert on table public.audit_log to service_role;
grant select, insert, update, delete on table public.idempotency_keys to service_role;

comment on table public.operator_profiles is
  'Internal operator profile linked one-to-one with auth.users.';

comment on table public.elements is
  'Canonical element registry. element_code preserves the legacy business ID.';

comment on table public.element_documents is
  'Document metadata and replacement history. File bytes remain in controlled storage.';

comment on table public.payments is
  'One row per element and monthly period. Active duplicates are prevented by a partial unique index.';

comment on table public.attendance_records is
  'Canonical attendance events without duplicated element names.';

comment on table public.audit_log is
  'Append-only audit trail. Never store access tokens, OTP values, or file contents.';

comment on table public.idempotency_keys is
  'Server-side idempotency registry. Cached responses must not contain tokens or unnecessary PII.';

commit;

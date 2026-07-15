-- Secure direct frontend access for PDMU APP v1.
-- Requires 202606290001_business_schema_v1.sql.

begin;

create table public.payment_fee_schedule (
  year integer not null,
  month integer not null,
  amount_cents integer not null,
  currency text not null default 'MXN',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (year, month),
  constraint payment_fee_schedule_year_check check (year between 2000 and 2100),
  constraint payment_fee_schedule_month_check check (month between 1 and 12),
  constraint payment_fee_schedule_amount_positive check (amount_cents > 0),
  constraint payment_fee_schedule_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint payment_fee_schedule_status_check check (status in ('active', 'inactive'))
);

create trigger payment_fee_schedule_set_updated_at
before insert or update on public.payment_fee_schedule
for each row execute function public.set_updated_at();

alter table public.payment_fee_schedule enable row level security;

revoke all on table public.payment_fee_schedule from anon, authenticated, service_role;
grant select, insert, update on table public.payment_fee_schedule to service_role;

comment on table public.payment_fee_schedule is
  'Authoritative monthly payment amounts used by record_payment; never supplied by the browser.';

create or replace function public.current_operator_profile()
returns public.operator_profiles
language sql
stable
security definer
set search_path = ''
as $$
  select op
  from public.operator_profiles as op
  where op.id = (select auth.uid())
    and op.status = 'active'
  limit 1
$$;

create or replace function public.current_operator_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select op.role
  from public.operator_profiles as op
  where op.id = (select auth.uid())
    and op.status = 'active'
  limit 1
$$;

create or replace function public.is_active_operator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.operator_profiles as op
    where op.id = (select auth.uid())
      and op.status = 'active'
  )
$$;

create or replace function public.is_admin_operator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.operator_profiles as op
    where op.id = (select auth.uid())
      and op.status = 'active'
      and op.role = 'admin'
  )
$$;

revoke all on function public.current_operator_profile() from public, anon;
revoke all on function public.current_operator_role() from public, anon;
revoke all on function public.is_active_operator() from public, anon;
revoke all on function public.is_admin_operator() from public, anon;
grant execute on function public.current_operator_profile() to authenticated;
grant execute on function public.current_operator_role() to authenticated;
grant execute on function public.is_active_operator() to authenticated;
grant execute on function public.is_admin_operator() to authenticated;

create policy operator_profiles_select_self_or_admin
on public.operator_profiles
for select
to authenticated
using (
  (id = (select auth.uid()) and status = 'active')
  or (select public.is_admin_operator())
);

create policy elements_select_visible
on public.elements
for select
to authenticated
using (
  (status = 'active' and (select public.is_active_operator()))
  or (select public.is_admin_operator())
);

create policy elements_insert_admin
on public.elements
for insert
to authenticated
with check ((select public.is_admin_operator()));

create policy elements_update_admin
on public.elements
for update
to authenticated
using ((select public.is_admin_operator()))
with check ((select public.is_admin_operator()));

create policy element_documents_select_visible
on public.element_documents
for select
to authenticated
using (
  (select public.is_admin_operator())
  or (
    status = 'active'
    and (select public.is_active_operator())
    and exists (
      select 1
      from public.elements as e
      where e.id = element_documents.element_id
        and e.status = 'active'
    )
  )
);

create policy element_documents_insert_admin
on public.element_documents
for insert
to authenticated
with check (
  (select public.is_admin_operator())
  and exists (select 1 from public.elements as e where e.id = element_id)
);

create policy element_documents_update_admin
on public.element_documents
for update
to authenticated
using ((select public.is_admin_operator()))
with check ((select public.is_admin_operator()));

create policy payments_select_active_operator
on public.payments
for select
to authenticated
using ((select public.is_active_operator()));

create policy attendance_select_active_operator
on public.attendance_records
for select
to authenticated
using ((select public.is_active_operator()));

create policy audit_log_select_admin
on public.audit_log
for select
to authenticated
using ((select public.is_admin_operator()));

grant select on table public.operator_profiles to authenticated;
grant select, insert, update on table public.elements to authenticated;
grant select, insert, update on table public.element_documents to authenticated;
grant select on table public.payments to authenticated;
grant select on table public.attendance_records to authenticated;
grant select on table public.audit_log to authenticated;

-- Internal idempotency helpers. They serialize each request key and are not callable by API roles.
create or replace function public._frontend_claim_request(
  p_request_id text,
  p_action text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.idempotency_keys%rowtype;
begin
  if nullif(btrim(p_request_id), '') is null or length(p_request_id) > 200 then
    raise exception 'INVALID_REQUEST_ID' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id, 0));

  select * into existing
  from public.idempotency_keys
  where key = p_request_id;

  if found then
    if existing.actor_user_id is distinct from (select auth.uid())
      or existing.action is distinct from p_action
      or existing.request_hash is distinct from p_request_hash
    then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;

    if existing.status = 'completed' then
      return existing.response;
    end if;

    raise exception 'REQUEST_ALREADY_IN_PROGRESS' using errcode = '55000';
  end if;

  insert into public.idempotency_keys (
    key, actor_user_id, action, request_hash, status, expires_at
  ) values (
    p_request_id, (select auth.uid()), p_action, p_request_hash, 'pending', now() + interval '24 hours'
  );

  return null;
end;
$$;

create or replace function public._frontend_complete_request(
  p_request_id text,
  p_response jsonb,
  p_response_status integer default 200
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.idempotency_keys
  set status = 'completed',
      response_status = p_response_status,
      response = p_response
  where key = p_request_id
    and actor_user_id = (select auth.uid());

  if not found then
    raise exception 'IDEMPOTENCY_REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public._frontend_claim_request(text, text, text) from public, anon, authenticated;
revoke all on function public._frontend_complete_request(text, jsonb, integer) from public, anon, authenticated;

create or replace function public.search_elements(
  p_query text,
  p_limit integer default 20,
  p_status text default 'active'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_query text := btrim(coalesce(p_query, ''));
  safe_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  result jsonb;
begin
  if not public.is_active_operator() then
    raise exception 'ACTIVE_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  if length(normalized_query) < 2 then
    raise exception 'QUERY_TOO_SHORT' using errcode = '22023';
  end if;

  if p_status is not null and p_status not in ('active', 'inactive', 'archived') then
    raise exception 'INVALID_ELEMENT_STATUS' using errcode = '22023';
  end if;

  if not public.is_admin_operator() then
    p_status := 'active';
  end if;

  select coalesce(jsonb_agg(item order by display_name, element_code), '[]'::jsonb)
  into result
  from (
    select
      e.id as element_id,
      e.element_code,
      concat_ws(' ', e.given_names, e.paternal_surname, e.maternal_surname) as display_name,
      e.group_code,
      e.status
    from public.elements as e
    where (p_status is null or e.status = p_status)
      and (
        e.element_code ilike '%' || normalized_query || '%'
        or concat_ws(' ', e.given_names, e.paternal_surname, e.maternal_surname)
          ilike '%' || normalized_query || '%'
      )
    order by display_name, e.element_code
    limit safe_limit
  ) as item;

  return jsonb_build_object(
    'ok', true,
    'items', result,
    'limit', safe_limit,
    'hasMore', jsonb_array_length(result) = safe_limit
  );
end;
$$;

create or replace function public.get_element(p_element_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  element_row public.elements%rowtype;
  documents jsonb;
begin
  if not public.is_active_operator() then
    raise exception 'ACTIVE_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  select * into element_row
  from public.elements
  where id = p_element_id
    and (status = 'active' or public.is_admin_operator());

  if not found then
    raise exception 'ELEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'documentId', d.id,
    'type', d.document_type,
    'fileName', d.original_filename,
    'mimeType', d.mime_type,
    'sizeBytes', d.size_bytes,
    'status', d.status,
    'version', d.version,
    'uploadedAt', d.uploaded_at
  ) order by d.document_type, d.version desc), '[]'::jsonb)
  into documents
  from public.element_documents as d
  where d.element_id = element_row.id
    and (d.status = 'active' or public.is_admin_operator());

  return jsonb_build_object(
    'ok', true,
    'element', jsonb_build_object(
      'elementId', element_row.id,
      'elementCode', element_row.element_code,
      'givenNames', element_row.given_names,
      'paternalSurname', element_row.paternal_surname,
      'maternalSurname', element_row.maternal_surname,
      'birthDate', element_row.birth_date,
      'sexCode', element_row.sex_code,
      'groupCode', element_row.group_code,
      'medicalNotes', element_row.medical_notes,
      'guardianName', element_row.guardian_name,
      'guardianPhone', element_row.guardian_phone,
      'status', element_row.status,
      'version', element_row.version,
      'createdAt', element_row.created_at,
      'updatedAt', element_row.updated_at
    ),
    'documents', documents
  );
end;
$$;

create or replace function public.create_element(
  p_request_id text,
  p_given_names text,
  p_paternal_surname text,
  p_birth_date date,
  p_sex_code text,
  p_guardian_name text,
  p_guardian_phone text,
  p_maternal_surname text default null,
  p_group_code text default null,
  p_medical_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_hash text;
  replay jsonb;
  new_id uuid := extensions.gen_random_uuid();
  new_code text;
  created public.elements%rowtype;
  response jsonb;
begin
  if not public.is_active_operator() then
    raise exception 'ACTIVE_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  if nullif(btrim(p_given_names), '') is null
    or nullif(btrim(p_paternal_surname), '') is null
    or p_birth_date is null
    or nullif(btrim(p_sex_code), '') is null
    or nullif(btrim(p_guardian_name), '') is null
    or nullif(btrim(p_guardian_phone), '') is null
  then
    raise exception 'REQUIRED_ELEMENT_FIELDS_MISSING' using errcode = '22023';
  end if;

  if p_birth_date > current_date then
    raise exception 'INVALID_BIRTH_DATE' using errcode = '22023';
  end if;

  if btrim(p_guardian_phone) !~ '^[0-9+() .-]{7,30}$' then
    raise exception 'INVALID_GUARDIAN_PHONE' using errcode = '22023';
  end if;

  request_hash := 'sha256:' || encode(extensions.digest(jsonb_build_object(
    'givenNames', btrim(p_given_names),
    'paternalSurname', btrim(p_paternal_surname),
    'maternalSurname', nullif(btrim(p_maternal_surname), ''),
    'birthDate', p_birth_date,
    'sexCode', upper(btrim(p_sex_code)),
    'groupCode', nullif(btrim(p_group_code), ''),
    'guardianName', btrim(p_guardian_name),
    'guardianPhone', btrim(p_guardian_phone),
    'medicalNotes', nullif(btrim(p_medical_notes), '')
  )::text, 'sha256'), 'hex');

  replay := public._frontend_claim_request(p_request_id, 'element.create', request_hash);
  if replay is not null then
    return replay;
  end if;

  new_code := 'PDMU-' || to_char(current_date, 'YYYYMMDD') || '-' ||
    upper(substr(replace(new_id::text, '-', ''), 1, 10));

  insert into public.elements (
    id, element_code, given_names, paternal_surname, maternal_surname,
    birth_date, sex_code, group_code, medical_notes, guardian_name,
    guardian_phone, status
  ) values (
    new_id, new_code, btrim(p_given_names), btrim(p_paternal_surname),
    nullif(btrim(p_maternal_surname), ''), p_birth_date, upper(btrim(p_sex_code)),
    nullif(btrim(p_group_code), ''), nullif(btrim(p_medical_notes), ''),
    btrim(p_guardian_name), btrim(p_guardian_phone), 'active'
  ) returning * into created;

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, after_data, request_id
  ) values (
    (select auth.uid()), 'element.created', 'element', created.id::text,
    jsonb_build_object('elementCode', created.element_code, 'status', created.status),
    p_request_id
  );

  response := jsonb_build_object(
    'ok', true,
    'element', jsonb_build_object(
      'elementId', created.id,
      'elementCode', created.element_code,
      'status', created.status,
      'version', created.version,
      'createdAt', created.created_at
    )
  );
  perform public._frontend_complete_request(p_request_id, response, 201);
  return response;
end;
$$;

create or replace function public.record_payment(
  p_request_id text,
  p_element_id uuid,
  p_year integer,
  p_month integer,
  p_method text,
  p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_hash text;
  replay jsonb;
  fee public.payment_fee_schedule%rowtype;
  new_id uuid := extensions.gen_random_uuid();
  created public.payments%rowtype;
  response jsonb;
begin
  if not public.is_active_operator() then
    raise exception 'ACTIVE_OPERATOR_REQUIRED' using errcode = '42501';
  end if;
  if p_year not between 2000 and 2100 or p_month not between 1 and 12 then
    raise exception 'INVALID_PAYMENT_PERIOD' using errcode = '22023';
  end if;
  if p_method not in ('cash', 'transfer') then
    raise exception 'PAYMENT_METHOD_NOT_ALLOWED' using errcode = '22023';
  end if;
  if not exists (select 1 from public.elements where id = p_element_id and status = 'active') then
    raise exception 'ELEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into fee
  from public.payment_fee_schedule
  where year = p_year and month = p_month and status = 'active';
  if not found then
    raise exception 'PAYMENT_POLICY_UNAVAILABLE' using errcode = 'P0001';
  end if;

  request_hash := 'sha256:' || encode(extensions.digest(jsonb_build_object(
    'elementId', p_element_id, 'year', p_year, 'month', p_month,
    'method', p_method, 'reference', nullif(btrim(p_reference), '')
  )::text, 'sha256'), 'hex');
  replay := public._frontend_claim_request(p_request_id, 'payment.create', request_hash);
  if replay is not null then return replay; end if;

  begin
    insert into public.payments (
      id, payment_code, element_id, year, month, amount_cents, currency,
      method, reference, status, recorded_at, recorded_by
    ) values (
      new_id,
      'PAY-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') || '-' ||
        upper(substr(replace(new_id::text, '-', ''), 1, 8)),
      p_element_id, p_year, p_month, fee.amount_cents, fee.currency,
      p_method, nullif(btrim(p_reference), ''), 'posted', clock_timestamp(),
      (select auth.uid())
    ) returning * into created;
  exception when unique_violation then
    raise exception 'PERIOD_ALREADY_PAID' using errcode = '23505';
  end;

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, after_data, request_id
  ) values (
    (select auth.uid()), 'payment.recorded', 'payment', created.id::text,
    jsonb_build_object(
      'elementId', created.element_id, 'year', created.year, 'month', created.month,
      'amountCents', created.amount_cents, 'currency', created.currency,
      'method', created.method, 'status', created.status
    ), p_request_id
  );

  response := jsonb_build_object(
    'ok', true,
    'payment', jsonb_build_object(
      'paymentId', created.id, 'paymentCode', created.payment_code,
      'elementId', created.element_id, 'year', created.year, 'month', created.month,
      'amount', jsonb_build_object('value', created.amount_cents, 'currency', created.currency),
      'method', created.method, 'reference', created.reference, 'status', created.status,
      'version', created.version, 'recordedAt', created.recorded_at
    )
  );
  perform public._frontend_complete_request(p_request_id, response, 201);
  return response;
end;
$$;

create or replace function public.list_payments(
  p_element_id uuid,
  p_year integer default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  items jsonb;
  safe_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  if not public.is_active_operator() then
    raise exception 'ACTIVE_OPERATOR_REQUIRED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.elements where id = p_element_id) then
    raise exception 'ELEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(row_data order by year desc, month desc), '[]'::jsonb)
  into items
  from (
    select
      p.id as payment_id, p.payment_code, p.year, p.month, p.amount_cents,
      p.currency, p.method, p.reference, p.status, p.version, p.recorded_at,
      p.cancelled_at, p.cancel_reason
    from public.payments as p
    where p.element_id = p_element_id and (p_year is null or p.year = p_year)
    order by p.year desc, p.month desc
    limit safe_limit
  ) as row_data;

  return jsonb_build_object('ok', true, 'elementId', p_element_id, 'items', items, 'limit', safe_limit);
end;
$$;

create or replace function public.record_attendance(
  p_request_id text,
  p_element_id uuid,
  p_status text default 'present',
  p_source text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_hash text;
  replay jsonb;
  new_id uuid := extensions.gen_random_uuid();
  created public.attendance_records%rowtype;
  response jsonb;
begin
  if not public.is_active_operator() then
    raise exception 'ACTIVE_OPERATOR_REQUIRED' using errcode = '42501';
  end if;
  if p_status not in ('present', 'absent', 'late', 'excused') then
    raise exception 'INVALID_ATTENDANCE_STATUS' using errcode = '22023';
  end if;
  if p_source not in ('manual', 'qr') then
    raise exception 'INVALID_ATTENDANCE_SOURCE' using errcode = '22023';
  end if;
  if not exists (select 1 from public.elements where id = p_element_id and status = 'active') then
    raise exception 'ELEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  request_hash := 'sha256:' || encode(extensions.digest(jsonb_build_object(
    'elementId', p_element_id, 'status', p_status, 'source', p_source
  )::text, 'sha256'), 'hex');
  replay := public._frontend_claim_request(p_request_id, 'attendance.create', request_hash);
  if replay is not null then return replay; end if;

  insert into public.attendance_records (
    id, attendance_code, element_id, occurred_at, attendance_date,
    status, source, record_status, recorded_by
  ) values (
    new_id,
    'ATT-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') || '-' ||
      upper(substr(replace(new_id::text, '-', ''), 1, 8)),
    p_element_id, clock_timestamp(), current_date,
    p_status, p_source, 'active', (select auth.uid())
  ) returning * into created;

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, after_data, request_id
  ) values (
    (select auth.uid()), 'attendance.recorded', 'attendance', created.id::text,
    jsonb_build_object(
      'elementId', created.element_id, 'status', created.status,
      'source', created.source, 'occurredAt', created.occurred_at,
      'recordStatus', created.record_status
    ), p_request_id
  );

  response := jsonb_build_object(
    'ok', true,
    'attendance', jsonb_build_object(
      'attendanceId', created.id, 'attendanceCode', created.attendance_code,
      'elementId', created.element_id, 'status', created.status,
      'source', created.source, 'recordStatus', created.record_status,
      'occurredAt', created.occurred_at, 'attendanceDate', created.attendance_date,
      'version', created.version
    )
  );
  perform public._frontend_complete_request(p_request_id, response, 201);
  return response;
end;
$$;

create or replace function public.list_attendance(
  p_element_id uuid,
  p_from date default null,
  p_to date default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  items jsonb;
  safe_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  if not public.is_active_operator() then
    raise exception 'ACTIVE_OPERATOR_REQUIRED' using errcode = '42501';
  end if;
  if p_from is not null and p_to is not null and (p_from > p_to or p_to - p_from > 366) then
    raise exception 'INVALID_ATTENDANCE_RANGE' using errcode = '22023';
  end if;
  if not exists (select 1 from public.elements where id = p_element_id) then
    raise exception 'ELEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(row_data order by occurred_at desc), '[]'::jsonb)
  into items
  from (
    select
      a.id as attendance_id, a.attendance_code, a.occurred_at, a.attendance_date,
      a.status, a.source, a.record_status, a.version, a.cancelled_at, a.cancel_reason
    from public.attendance_records as a
    where a.element_id = p_element_id
      and (p_from is null or a.attendance_date >= p_from)
      and (p_to is null or a.attendance_date <= p_to)
    order by a.occurred_at desc
    limit safe_limit
  ) as row_data;

  return jsonb_build_object('ok', true, 'elementId', p_element_id, 'items', items, 'limit', safe_limit);
end;
$$;

-- Admin-only logical cancellations. General corrections remain a separate, explicit next phase.
create or replace function public.cancel_payment(
  p_request_id text,
  p_payment_id uuid,
  p_expected_version integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.payments%rowtype;
  changed public.payments%rowtype;
  request_hash text;
  replay jsonb;
  response jsonb;
begin
  if not public.is_admin_operator() then
    raise exception 'ADMIN_OPERATOR_REQUIRED' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'CANCEL_REASON_REQUIRED' using errcode = '22023';
  end if;
  request_hash := 'sha256:' || encode(extensions.digest(jsonb_build_object(
    'paymentId', p_payment_id, 'expectedVersion', p_expected_version, 'reason', btrim(p_reason)
  )::text, 'sha256'), 'hex');
  replay := public._frontend_claim_request(p_request_id, 'payment.cancel', request_hash);
  if replay is not null then return replay; end if;

  select * into before_row from public.payments where id = p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if before_row.status = 'cancelled' then raise exception 'PAYMENT_CANCELLED' using errcode = '55000'; end if;
  if before_row.version <> p_expected_version then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;

  update public.payments
  set status = 'cancelled', cancelled_at = clock_timestamp(),
      cancelled_by = (select auth.uid()), cancel_reason = btrim(p_reason)
  where id = p_payment_id
  returning * into changed;

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, before_data, after_data, reason, request_id
  ) values (
    (select auth.uid()), 'payment.cancelled', 'payment', changed.id::text,
    jsonb_build_object('status', before_row.status, 'version', before_row.version),
    jsonb_build_object('status', changed.status, 'version', changed.version, 'cancelledAt', changed.cancelled_at),
    btrim(p_reason), p_request_id
  );

  response := jsonb_build_object('ok', true, 'payment', jsonb_build_object(
    'paymentId', changed.id, 'status', changed.status, 'version', changed.version,
    'cancelledAt', changed.cancelled_at, 'cancelReason', changed.cancel_reason
  ));
  perform public._frontend_complete_request(p_request_id, response, 200);
  return response;
end;
$$;

create or replace function public.cancel_attendance(
  p_request_id text,
  p_attendance_id uuid,
  p_expected_version integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.attendance_records%rowtype;
  changed public.attendance_records%rowtype;
  request_hash text;
  replay jsonb;
  response jsonb;
begin
  if not public.is_admin_operator() then
    raise exception 'ADMIN_OPERATOR_REQUIRED' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'CANCEL_REASON_REQUIRED' using errcode = '22023';
  end if;
  request_hash := 'sha256:' || encode(extensions.digest(jsonb_build_object(
    'attendanceId', p_attendance_id, 'expectedVersion', p_expected_version, 'reason', btrim(p_reason)
  )::text, 'sha256'), 'hex');
  replay := public._frontend_claim_request(p_request_id, 'attendance.cancel', request_hash);
  if replay is not null then return replay; end if;

  select * into before_row from public.attendance_records where id = p_attendance_id for update;
  if not found then raise exception 'ATTENDANCE_NOT_FOUND' using errcode = 'P0002'; end if;
  if before_row.record_status = 'cancelled' then raise exception 'ATTENDANCE_CANCELLED' using errcode = '55000'; end if;
  if before_row.version <> p_expected_version then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;

  update public.attendance_records
  set record_status = 'cancelled', cancelled_at = clock_timestamp(),
      cancelled_by = (select auth.uid()), cancel_reason = btrim(p_reason)
  where id = p_attendance_id
  returning * into changed;

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, before_data, after_data, reason, request_id
  ) values (
    (select auth.uid()), 'attendance.cancelled', 'attendance', changed.id::text,
    jsonb_build_object('recordStatus', before_row.record_status, 'version', before_row.version),
    jsonb_build_object('recordStatus', changed.record_status, 'version', changed.version, 'cancelledAt', changed.cancelled_at),
    btrim(p_reason), p_request_id
  );

  response := jsonb_build_object('ok', true, 'attendance', jsonb_build_object(
    'attendanceId', changed.id, 'recordStatus', changed.record_status, 'version', changed.version,
    'cancelledAt', changed.cancelled_at, 'cancelReason', changed.cancel_reason
  ));
  perform public._frontend_complete_request(p_request_id, response, 200);
  return response;
end;
$$;

create or replace function public.get_dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today_mx date := (now() at time zone 'America/Mexico_City')::date;
  current_year integer := extract(year from (now() at time zone 'America/Mexico_City'))::integer;
  current_month integer := extract(month from (now() at time zone 'America/Mexico_City'))::integer;
  active_elements integer;
  scheduled_periods integer;
  posted_payments integer;
  pending_payments integer;
  attendance_today integer;
  absences_today integer;
  documents_pending integer;
  important_alerts jsonb := '[]'::jsonb;
  recent_activity jsonb;
begin
  if not public.is_active_operator() then
    raise exception 'ACTIVE_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  select count(*)::integer
  into active_elements
  from public.elements as e
  where e.status = 'active';

  select count(*)::integer
  into scheduled_periods
  from public.payment_fee_schedule as pfs
  where pfs.year = current_year
    and pfs.month <= current_month
    and pfs.status = 'active';

  select count(*)::integer
  into posted_payments
  from public.payments as p
  join public.elements as e on e.id = p.element_id
  where e.status = 'active'
    and p.status = 'posted'
    and p.year = current_year
    and p.month <= current_month;

  pending_payments := greatest((active_elements * scheduled_periods) - posted_payments, 0);

  select count(*)::integer
  into attendance_today
  from public.attendance_records as a
  join public.elements as e on e.id = a.element_id
  where e.status = 'active'
    and a.record_status = 'active'
    and a.status = 'present'
    and a.attendance_date = today_mx;

  select count(*)::integer
  into absences_today
  from public.attendance_records as a
  join public.elements as e on e.id = a.element_id
  where e.status = 'active'
    and a.record_status = 'active'
    and a.status = 'absent'
    and a.attendance_date = today_mx;

  select count(*)::integer
  into documents_pending
  from public.elements as e
  where e.status = 'active'
    and (
      select count(*)
      from public.element_documents as d
      where d.element_id = e.id
        and d.status = 'active'
    ) < 6;

  if pending_payments > 0 then
    important_alerts := important_alerts || jsonb_build_array(
      pending_payments::text || ' mensualidad(es) pendiente(s) hasta ' || current_month::text || '/' || current_year::text || '.'
    );
  end if;

  if documents_pending > 0 then
    important_alerts := important_alerts || jsonb_build_array(
      documents_pending::text || ' expediente(s) con documentación incompleta.'
    );
  end if;

  if absences_today > 0 then
    important_alerts := important_alerts || jsonb_build_array(
      absences_today::text || ' falta(s) registrada(s) hoy.'
    );
  end if;

  select coalesce(jsonb_agg(activity.label order by activity.occurred_at desc), '[]'::jsonb)
  into recent_activity
  from (
    select *
    from (
      select
        p.recorded_at as occurred_at,
        'Pago registrado: ' ||
          concat_ws(' ', e.given_names, e.paternal_surname, e.maternal_surname) ||
          ' - ' || p.month::text || '/' || p.year::text as label
      from public.payments as p
      join public.elements as e on e.id = p.element_id
      where p.status = 'posted'

      union all

      select
        a.occurred_at as occurred_at,
        'Asistencia registrada: ' ||
          concat_ws(' ', e.given_names, e.paternal_surname, e.maternal_surname) as label
      from public.attendance_records as a
      join public.elements as e on e.id = a.element_id
      where a.record_status = 'active'
    ) as all_activity
    order by occurred_at desc
    limit 5
  ) as activity
  ;

  return jsonb_build_object(
    'ok', true,
    'resumenRapido', jsonb_build_object(
      'elementosActivos', active_elements,
      'pagosPendientes', pending_payments,
      'asistenciasHoy', attendance_today,
      'faltasHoy', absences_today
    ),
    'alertasImportantes', important_alerts,
    'actividadReciente', recent_activity
  );
end;
$$;

revoke all on function public.search_elements(text, integer, text) from public, anon;
revoke all on function public.get_element(uuid) from public, anon;
revoke all on function public.create_element(text, text, text, date, text, text, text, text, text, text) from public, anon;
revoke all on function public.record_payment(text, uuid, integer, integer, text, text) from public, anon;
revoke all on function public.list_payments(uuid, integer, integer) from public, anon;
revoke all on function public.record_attendance(text, uuid, text, text) from public, anon;
revoke all on function public.list_attendance(uuid, date, date, integer) from public, anon;
revoke all on function public.cancel_payment(text, uuid, integer, text) from public, anon;
revoke all on function public.cancel_attendance(text, uuid, integer, text) from public, anon;
revoke all on function public.get_dashboard_summary() from public, anon;

grant execute on function public.search_elements(text, integer, text) to authenticated;
grant execute on function public.get_element(uuid) to authenticated;
grant execute on function public.create_element(text, text, text, date, text, text, text, text, text, text) to authenticated;
grant execute on function public.record_payment(text, uuid, integer, integer, text, text) to authenticated;
grant execute on function public.list_payments(uuid, integer, integer) to authenticated;
grant execute on function public.record_attendance(text, uuid, text, text) to authenticated;
grant execute on function public.list_attendance(uuid, date, date, integer) to authenticated;
grant execute on function public.cancel_payment(text, uuid, integer, text) to authenticated;
grant execute on function public.cancel_attendance(text, uuid, integer, text) to authenticated;
grant execute on function public.get_dashboard_summary() to authenticated;

comment on function public.record_payment(text, uuid, integer, integer, text, text) is
  'Records a payment using only the authoritative server-side payment_fee_schedule amount.';
comment on function public.record_attendance(text, uuid, text, text) is
  'Records attendance with server-side timestamps and authenticated actor attribution.';

commit;

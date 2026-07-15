-- Element enrollment history.
-- elements remains the canonical person record; element_enrollments stores each
-- active/closed registration period so re-entries do not create duplicates.

begin;

create table if not exists public.element_enrollments (
  id uuid primary key default gen_random_uuid(),
  enrollment_code text not null,
  element_id uuid not null references public.elements (id) on delete restrict,
  enrolled_on date not null,
  billing_start_on date not null,
  billing_policy text not null default 'first_15_current_else_next',
  status text not null default 'active',
  dropped_on date,
  drop_reason text,
  created_by uuid references public.operator_profiles (id) on delete set null,
  dropped_by uuid references public.operator_profiles (id) on delete set null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint element_enrollments_code_not_blank check (btrim(enrollment_code) <> ''),
  constraint element_enrollments_status_check check (status in ('active', 'closed', 'cancelled')),
  constraint element_enrollments_billing_policy_check check (billing_policy in ('first_15_current_else_next')),
  constraint element_enrollments_dates_check check (
    billing_start_on = public.calculate_billing_start_date(enrolled_on, billing_policy)
    and (dropped_on is null or dropped_on >= enrolled_on)
  ),
  constraint element_enrollments_close_check check (
    (
      status = 'active'
      and dropped_on is null
      and dropped_by is null
      and drop_reason is null
    )
    or
    (
      status in ('closed', 'cancelled')
      and dropped_on is not null
      and nullif(btrim(drop_reason), '') is not null
    )
  )
);

drop trigger if exists element_enrollments_set_updated_at on public.element_enrollments;
create trigger element_enrollments_set_updated_at
before insert or update on public.element_enrollments
for each row execute function public.set_updated_at_and_increment_version();

create unique index if not exists element_enrollments_code_lower_uidx
  on public.element_enrollments (lower(btrim(enrollment_code)));

create unique index if not exists element_enrollments_active_element_uidx
  on public.element_enrollments (element_id)
  where status = 'active';

create index if not exists element_enrollments_element_status_idx
  on public.element_enrollments (element_id, status, enrolled_on desc);

create index if not exists element_enrollments_billing_idx
  on public.element_enrollments (status, billing_start_on);

alter table public.element_enrollments enable row level security;

revoke all on table public.element_enrollments from anon, authenticated, service_role;
grant select, insert, update on table public.element_enrollments to authenticated;
grant select, insert, update on table public.element_enrollments to service_role;

drop policy if exists element_enrollments_select_visible on public.element_enrollments;
create policy element_enrollments_select_visible
on public.element_enrollments
for select
to authenticated
using (
  (select public.is_admin_operator())
  or (
    (select public.is_active_operator())
    and exists (
      select 1
      from public.elements as e
      where e.id = element_enrollments.element_id
        and e.status = 'active'
    )
  )
);

drop policy if exists element_enrollments_insert_admin on public.element_enrollments;
create policy element_enrollments_insert_admin
on public.element_enrollments
for insert
to authenticated
with check ((select public.is_admin_operator()));

drop policy if exists element_enrollments_update_admin on public.element_enrollments;
create policy element_enrollments_update_admin
on public.element_enrollments
for update
to authenticated
using ((select public.is_admin_operator()))
with check ((select public.is_admin_operator()));

insert into public.element_enrollments (
  id,
  enrollment_code,
  element_id,
  enrolled_on,
  billing_start_on,
  billing_policy,
  status,
  dropped_on,
  drop_reason,
  created_by
)
select
  extensions.gen_random_uuid(),
  'ENR-' || e.element_code || '-001',
  e.id,
  coalesce(e.enrolled_on, (e.created_at at time zone 'America/Mexico_City')::date),
  coalesce(
    e.billing_start_on,
    public.calculate_billing_start_date(
      coalesce(e.enrolled_on, (e.created_at at time zone 'America/Mexico_City')::date),
      coalesce(e.billing_policy, 'first_15_current_else_next')
    )
  ),
  coalesce(e.billing_policy, 'first_15_current_else_next'),
  case when e.status = 'active' then 'active' else 'closed' end,
  case when e.status = 'active' then null else (e.updated_at at time zone 'America/Mexico_City')::date end,
  case when e.status = 'active' then null else 'Migración inicial de historial de inscripción' end,
  null
from public.elements as e
where not exists (
  select 1
  from public.element_enrollments as ee
  where ee.element_id = e.id
);

alter table public.payments
  add column if not exists enrollment_id uuid references public.element_enrollments (id) on delete restrict;

update public.payments as p
set enrollment_id = (
  select ee.id as enrollment_id
  from public.element_enrollments as ee
  where ee.element_id = p.element_id
    and make_date(p.year, p.month, 1) >= date_trunc('month', ee.billing_start_on)::date
    and (
      ee.dropped_on is null
      or make_date(p.year, p.month, 1) <= date_trunc('month', ee.dropped_on)::date
    )
  order by ee.enrolled_on desc, ee.created_at desc
  limit 1
)
where p.enrollment_id is null;

update public.payments as p
set enrollment_id = (
  select ee.id as enrollment_id
  from public.element_enrollments as ee
  where ee.element_id = p.element_id
  order by ee.enrolled_on desc, ee.created_at desc
  limit 1
)
where p.enrollment_id is null;

drop index if exists public.payments_active_period_uidx;

create unique index if not exists payments_active_enrollment_period_uidx
  on public.payments (enrollment_id, year, month)
  where status = 'posted' and enrollment_id is not null;

create index if not exists payments_enrollment_year_idx
  on public.payments (enrollment_id, year, month);

create or replace function public.normalize_person_match_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(lower(btrim(coalesce(p_value, ''))), '\s+', ' ', 'g')
$$;

create or replace function public.find_matching_element(
  p_given_names text,
  p_paternal_surname text,
  p_maternal_surname text,
  p_birth_date date
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.elements as e
  where e.birth_date = p_birth_date
    and public.normalize_person_match_text(e.given_names) =
      public.normalize_person_match_text(p_given_names)
    and public.normalize_person_match_text(e.paternal_surname) =
      public.normalize_person_match_text(p_paternal_surname)
    and public.normalize_person_match_text(coalesce(e.maternal_surname, '')) =
      public.normalize_person_match_text(coalesce(p_maternal_surname, ''))
  order by
    case e.status when 'active' then 0 when 'inactive' then 1 else 2 end,
    e.updated_at desc
  limit 1
$$;

create or replace function public.get_active_element_enrollment(p_element_id uuid)
returns public.element_enrollments
language sql
stable
security definer
set search_path = ''
as $$
  select ee
  from public.element_enrollments as ee
  where ee.element_id = p_element_id
    and ee.status = 'active'
  order by ee.enrolled_on desc, ee.created_at desc
  limit 1
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
  p_medical_notes text default null,
  p_enrolled_on date default null,
  p_billing_policy text default 'first_15_current_else_next'
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
  enrollment_date date := coalesce(p_enrolled_on, (now() at time zone 'America/Mexico_City')::date);
  normalized_policy text := coalesce(nullif(btrim(p_billing_policy), ''), 'first_15_current_else_next');
  billing_start date;
  created public.elements%rowtype;
  matched_element_id uuid;
  existing_element public.elements%rowtype;
  active_enrollment public.element_enrollments%rowtype;
  enrollment_row public.element_enrollments%rowtype;
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

  if enrollment_date > (now() at time zone 'America/Mexico_City')::date then
    raise exception 'INVALID_ENROLLMENT_DATE' using errcode = '22023';
  end if;

  if btrim(p_guardian_phone) !~ '^[0-9+() .-]{7,30}$' then
    raise exception 'INVALID_GUARDIAN_PHONE' using errcode = '22023';
  end if;

  billing_start := public.calculate_billing_start_date(enrollment_date, normalized_policy);

  request_hash := 'sha256:' || encode(extensions.digest(jsonb_build_object(
    'givenNames', btrim(p_given_names),
    'paternalSurname', btrim(p_paternal_surname),
    'maternalSurname', nullif(btrim(p_maternal_surname), ''),
    'birthDate', p_birth_date,
    'sexCode', upper(btrim(p_sex_code)),
    'groupCode', nullif(btrim(p_group_code), ''),
    'guardianName', btrim(p_guardian_name),
    'guardianPhone', btrim(p_guardian_phone),
    'medicalNotes', nullif(btrim(p_medical_notes), ''),
    'enrolledOn', enrollment_date,
    'billingPolicy', normalized_policy
  )::text, 'sha256'), 'hex');

  replay := public._frontend_claim_request(p_request_id, 'element.create', request_hash);
  if replay is not null then
    return replay;
  end if;

  matched_element_id := public.find_matching_element(
    p_given_names,
    p_paternal_surname,
    p_maternal_surname,
    p_birth_date
  );

  if matched_element_id is not null then
    select * into existing_element
    from public.elements
    where id = matched_element_id
    for update;

    select * into active_enrollment
    from public.element_enrollments
    where element_id = existing_element.id
      and status = 'active'
    for update;

    if found then
      raise exception 'ELEMENT_ALREADY_EXISTS' using errcode = '23505';
    end if;

    update public.elements
    set
      given_names = btrim(p_given_names),
      paternal_surname = btrim(p_paternal_surname),
      maternal_surname = nullif(btrim(p_maternal_surname), ''),
      sex_code = upper(btrim(p_sex_code)),
      group_code = nullif(btrim(p_group_code), ''),
      medical_notes = nullif(btrim(p_medical_notes), ''),
      guardian_name = btrim(p_guardian_name),
      guardian_phone = btrim(p_guardian_phone),
      enrolled_on = enrollment_date,
      billing_start_on = billing_start,
      billing_policy = normalized_policy,
      status = 'active'
    where id = existing_element.id
    returning * into created;

    insert into public.element_enrollments (
      enrollment_code,
      element_id,
      enrolled_on,
      billing_start_on,
      billing_policy,
      status,
      created_by
    ) values (
      'ENR-' || created.element_code || '-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS'),
      created.id,
      enrollment_date,
      billing_start,
      normalized_policy,
      'active',
      (select auth.uid())
    ) returning * into enrollment_row;

    insert into public.audit_log (
      actor_user_id, action, entity_type, entity_id, after_data, request_id
    ) values (
      (select auth.uid()), 'element.reenrolled', 'element', created.id::text,
      jsonb_build_object(
        'elementCode', created.element_code,
        'enrollmentId', enrollment_row.id,
        'enrolledOn', enrollment_row.enrolled_on,
        'billingStartOn', enrollment_row.billing_start_on,
        'status', created.status
      ),
      p_request_id
    );

    response := jsonb_build_object(
      'ok', true,
      'element', jsonb_build_object(
        'elementId', created.id,
        'elementCode', created.element_code,
        'enrollmentId', enrollment_row.id,
        'enrollmentCode', enrollment_row.enrollment_code,
        'reactivated', true,
        'status', created.status,
        'enrolledOn', enrollment_row.enrolled_on,
        'billingStartOn', enrollment_row.billing_start_on,
        'billingPolicy', enrollment_row.billing_policy,
        'version', created.version,
        'createdAt', created.created_at
      )
    );
    perform public._frontend_complete_request(p_request_id, response, 200);
    return response;
  end if;

  new_code := 'PDMU-' || to_char(current_date, 'YYYYMMDD') || '-' ||
    upper(substr(replace(new_id::text, '-', ''), 1, 10));

  insert into public.elements (
    id, element_code, given_names, paternal_surname, maternal_surname,
    birth_date, sex_code, group_code, medical_notes, guardian_name,
    guardian_phone, enrolled_on, billing_start_on, billing_policy, status
  ) values (
    new_id, new_code, btrim(p_given_names), btrim(p_paternal_surname),
    nullif(btrim(p_maternal_surname), ''), p_birth_date, upper(btrim(p_sex_code)),
    nullif(btrim(p_group_code), ''), nullif(btrim(p_medical_notes), ''),
    btrim(p_guardian_name), btrim(p_guardian_phone), enrollment_date,
    billing_start, normalized_policy, 'active'
  ) returning * into created;

  insert into public.element_enrollments (
    enrollment_code,
    element_id,
    enrolled_on,
    billing_start_on,
    billing_policy,
    status,
    created_by
  ) values (
    'ENR-' || created.element_code || '-001',
    created.id,
    enrollment_date,
    billing_start,
    normalized_policy,
    'active',
    (select auth.uid())
  ) returning * into enrollment_row;

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, after_data, request_id
  ) values (
    (select auth.uid()), 'element.created', 'element', created.id::text,
    jsonb_build_object(
      'elementCode', created.element_code,
      'enrollmentId', enrollment_row.id,
      'status', created.status,
      'enrolledOn', enrollment_row.enrolled_on,
      'billingStartOn', enrollment_row.billing_start_on,
      'billingPolicy', enrollment_row.billing_policy
    ),
    p_request_id
  );

  response := jsonb_build_object(
    'ok', true,
    'element', jsonb_build_object(
      'elementId', created.id,
      'elementCode', created.element_code,
      'enrollmentId', enrollment_row.id,
      'enrollmentCode', enrollment_row.enrollment_code,
      'reactivated', false,
      'status', created.status,
      'enrolledOn', enrollment_row.enrolled_on,
      'billingStartOn', enrollment_row.billing_start_on,
      'billingPolicy', enrollment_row.billing_policy,
      'version', created.version,
      'createdAt', created.created_at
    )
  );
  perform public._frontend_complete_request(p_request_id, response, 201);
  return response;
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
  enrollment_row public.element_enrollments%rowtype;
  documents jsonb;
  enrollments jsonb;
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

  select * into enrollment_row
  from public.element_enrollments
  where element_id = element_row.id
    and status = 'active'
  order by enrolled_on desc, created_at desc
  limit 1;

  if not found then
    select * into enrollment_row
    from public.element_enrollments
    where element_id = element_row.id
    order by enrolled_on desc, created_at desc
    limit 1;
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

  select coalesce(jsonb_agg(jsonb_build_object(
    'enrollmentId', ee.id,
    'enrollmentCode', ee.enrollment_code,
    'enrolledOn', ee.enrolled_on,
    'billingStartOn', ee.billing_start_on,
    'billingPolicy', ee.billing_policy,
    'status', ee.status,
    'droppedOn', ee.dropped_on,
    'dropReason', ee.drop_reason,
    'version', ee.version,
    'createdAt', ee.created_at,
    'updatedAt', ee.updated_at
  ) order by ee.enrolled_on desc, ee.created_at desc), '[]'::jsonb)
  into enrollments
  from public.element_enrollments as ee
  where ee.element_id = element_row.id;

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
      'enrollmentId', enrollment_row.id,
      'enrollmentCode', enrollment_row.enrollment_code,
      'enrolledOn', coalesce(enrollment_row.enrolled_on, element_row.enrolled_on),
      'billingStartOn', coalesce(enrollment_row.billing_start_on, element_row.billing_start_on),
      'billingPolicy', coalesce(enrollment_row.billing_policy, element_row.billing_policy),
      'status', element_row.status,
      'version', element_row.version,
      'createdAt', element_row.created_at,
      'updatedAt', element_row.updated_at
    ),
    'activeEnrollment', case when enrollment_row.id is null then null else jsonb_build_object(
      'enrollmentId', enrollment_row.id,
      'enrollmentCode', enrollment_row.enrollment_code,
      'enrolledOn', enrollment_row.enrolled_on,
      'billingStartOn', enrollment_row.billing_start_on,
      'billingPolicy', enrollment_row.billing_policy,
      'status', enrollment_row.status
    ) end,
    'enrollments', enrollments,
    'documents', documents
  );
end;
$$;

create or replace function public.deactivate_element(
  p_request_id text,
  p_element_id uuid,
  p_reason text,
  p_dropped_on date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_hash text;
  replay jsonb;
  element_row public.elements%rowtype;
  enrollment_row public.element_enrollments%rowtype;
  changed public.element_enrollments%rowtype;
  drop_date date := coalesce(p_dropped_on, (now() at time zone 'America/Mexico_City')::date);
  response jsonb;
begin
  if not public.is_admin_operator() then
    raise exception 'ADMIN_OPERATOR_REQUIRED' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'CANCEL_REASON_REQUIRED' using errcode = '22023';
  end if;
  if drop_date > (now() at time zone 'America/Mexico_City')::date then
    raise exception 'INVALID_ENROLLMENT_DATE' using errcode = '22023';
  end if;

  request_hash := 'sha256:' || encode(extensions.digest(jsonb_build_object(
    'elementId', p_element_id,
    'reason', btrim(p_reason),
    'droppedOn', drop_date
  )::text, 'sha256'), 'hex');

  replay := public._frontend_claim_request(p_request_id, 'element.deactivate', request_hash);
  if replay is not null then
    return replay;
  end if;

  select * into element_row
  from public.elements
  where id = p_element_id
  for update;

  if not found then
    raise exception 'ELEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into enrollment_row
  from public.element_enrollments
  where element_id = p_element_id
    and status = 'active'
  order by enrolled_on desc, created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'ACTIVE_ENROLLMENT_REQUIRED' using errcode = '22023';
  end if;

  if drop_date < enrollment_row.enrolled_on then
    raise exception 'INVALID_ENROLLMENT_DATE' using errcode = '22023';
  end if;

  update public.element_enrollments
  set
    status = 'closed',
    dropped_on = drop_date,
    dropped_by = (select auth.uid()),
    drop_reason = btrim(p_reason)
  where id = enrollment_row.id
  returning * into changed;

  update public.elements
  set status = 'inactive'
  where id = p_element_id;

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, before_data, after_data, reason, request_id
  ) values (
    (select auth.uid()), 'element.deactivated', 'element', p_element_id::text,
    jsonb_build_object('status', element_row.status, 'enrollmentId', enrollment_row.id),
    jsonb_build_object('status', 'inactive', 'enrollmentId', changed.id, 'droppedOn', changed.dropped_on),
    btrim(p_reason), p_request_id
  );

  response := jsonb_build_object(
    'ok', true,
    'element', jsonb_build_object(
      'elementId', p_element_id,
      'status', 'inactive',
      'enrollmentId', changed.id,
      'enrollmentStatus', changed.status,
      'droppedOn', changed.dropped_on,
      'dropReason', changed.drop_reason
    )
  );
  perform public._frontend_complete_request(p_request_id, response, 200);
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
  element_row public.elements%rowtype;
  enrollment_row public.element_enrollments%rowtype;
  period_start date;
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

  period_start := make_date(p_year, p_month, 1);

  select * into element_row
  from public.elements
  where id = p_element_id and status = 'active';
  if not found then
    raise exception 'ELEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into enrollment_row
  from public.element_enrollments
  where element_id = p_element_id and status = 'active'
  order by enrolled_on desc, created_at desc
  limit 1;
  if not found then
    raise exception 'ACTIVE_ENROLLMENT_REQUIRED' using errcode = '22023';
  end if;

  if period_start < date_trunc('month', enrollment_row.billing_start_on)::date then
    raise exception 'PAYMENT_PERIOD_NOT_APPLICABLE' using errcode = '22023';
  end if;

  select * into fee
  from public.payment_fee_schedule
  where year = p_year and month = p_month and status = 'active';
  if not found then
    raise exception 'PAYMENT_POLICY_UNAVAILABLE' using errcode = 'P0001';
  end if;

  request_hash := 'sha256:' || encode(extensions.digest(jsonb_build_object(
    'elementId', p_element_id, 'enrollmentId', enrollment_row.id, 'year', p_year, 'month', p_month,
    'method', p_method, 'reference', nullif(btrim(p_reference), '')
  )::text, 'sha256'), 'hex');
  replay := public._frontend_claim_request(p_request_id, 'payment.create', request_hash);
  if replay is not null then return replay; end if;

  begin
    insert into public.payments (
      id, payment_code, element_id, enrollment_id, year, month, amount_cents, currency,
      method, reference, status, recorded_at, recorded_by
    ) values (
      new_id,
      'PAY-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') || '-' ||
        upper(substr(replace(new_id::text, '-', ''), 1, 8)),
      p_element_id, enrollment_row.id, p_year, p_month, fee.amount_cents, fee.currency,
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
      'elementId', created.element_id, 'enrollmentId', created.enrollment_id,
      'year', created.year, 'month', created.month,
      'amountCents', created.amount_cents, 'currency', created.currency,
      'method', created.method, 'status', created.status
    ), p_request_id
  );

  response := jsonb_build_object(
    'ok', true,
    'payment', jsonb_build_object(
      'paymentId', created.id, 'paymentCode', created.payment_code,
      'elementId', created.element_id, 'enrollmentId', created.enrollment_id,
      'year', created.year, 'month', created.month,
      'amount', jsonb_build_object('value', created.amount_cents, 'currency', created.currency),
      'method', created.method, 'reference', created.reference, 'status', created.status,
      'version', created.version, 'recordedAt', created.recorded_at
    )
  );
  perform public._frontend_complete_request(p_request_id, response, 201);
  return response;
end;
$$;

create or replace function public.get_element_payment_statement(
  p_element_id uuid,
  p_year integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  element_row public.elements%rowtype;
  enrollment_row public.element_enrollments%rowtype;
  statement_year integer := coalesce(p_year, extract(year from timezone('America/Mexico_City', now()))::integer);
  current_month_start date := date_trunc('month', timezone('America/Mexico_City', now()))::date;
  billing_month_start date;
  months jsonb;
  summary jsonb;
begin
  if not public.is_active_operator() then
    raise exception 'ACTIVE_OPERATOR_REQUIRED' using errcode = '42501';
  end if;
  if statement_year not between 2000 and 2100 then
    raise exception 'INVALID_PAYMENT_PERIOD' using errcode = '22023';
  end if;

  select * into element_row
  from public.elements
  where id = p_element_id
    and (status = 'active' or public.is_admin_operator());

  if not found then
    raise exception 'ELEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into enrollment_row
  from public.element_enrollments
  where element_id = element_row.id
    and status = 'active'
  order by enrolled_on desc, created_at desc
  limit 1;

  if not found then
    select * into enrollment_row
    from public.element_enrollments
    where element_id = element_row.id
    order by enrolled_on desc, created_at desc
    limit 1;
  end if;

  if enrollment_row.id is null then
    raise exception 'ACTIVE_ENROLLMENT_REQUIRED' using errcode = '22023';
  end if;

  billing_month_start := date_trunc('month', enrollment_row.billing_start_on)::date;

  with month_rows as (
    select
      statement_year as year,
      series.month,
      make_date(statement_year, series.month, 1) as period_start
    from generate_series(1, 12) as series(month)
  ),
  decorated as (
    select
      mr.year,
      mr.month,
      mr.period_start,
      fee.amount_cents as scheduled_amount_cents,
      coalesce(fee.currency, 'MXN') as scheduled_currency,
      posted.id as payment_id,
      posted.payment_code,
      posted.amount_cents as paid_amount_cents,
      posted.currency as paid_currency,
      posted.method,
      posted.reference,
      posted.status as payment_status,
      posted.version,
      posted.recorded_at,
      cancelled.id as cancelled_payment_id,
      cancelled.cancel_reason,
      cancelled.cancelled_at,
      case
        when mr.period_start < billing_month_start then 'not_applicable'
        when posted.id is not null then 'paid'
        when fee.year is null then 'unconfigured'
        when mr.period_start > current_month_start then 'future'
        when mr.period_start < current_month_start then 'overdue'
        else 'pending'
      end as period_status
    from month_rows as mr
    left join public.payment_fee_schedule as fee
      on fee.year = mr.year
      and fee.month = mr.month
      and fee.status = 'active'
    left join public.payments as posted
      on posted.enrollment_id = enrollment_row.id
      and posted.year = mr.year
      and posted.month = mr.month
      and posted.status = 'posted'
    left join lateral (
      select c.*
      from public.payments as c
      where c.enrollment_id = enrollment_row.id
        and c.year = mr.year
        and c.month = mr.month
        and c.status = 'cancelled'
      order by c.cancelled_at desc nulls last, c.recorded_at desc
      limit 1
    ) as cancelled on true
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'year', year,
      'month', month,
      'periodStart', period_start,
      'status', period_status,
      'amount', jsonb_build_object(
        'value', scheduled_amount_cents,
        'currency', scheduled_currency
      ),
      'payment', case when payment_id is null then null else jsonb_build_object(
        'paymentId', payment_id,
        'paymentCode', payment_code,
        'year', year,
        'month', month,
        'amount', jsonb_build_object(
          'value', paid_amount_cents,
          'currency', paid_currency
        ),
        'method', method,
        'reference', reference,
        'status', payment_status,
        'version', version,
        'recordedAt', recorded_at
      ) end,
      'latestCancellation', case when cancelled_payment_id is null then null else jsonb_build_object(
        'paymentId', cancelled_payment_id,
        'cancelReason', cancel_reason,
        'cancelledAt', cancelled_at
      ) end
    ) order by month), '[]'::jsonb)
  into months
  from decorated;

  with month_rows as (
    select
      statement_year as year,
      series.month,
      make_date(statement_year, series.month, 1) as period_start
    from generate_series(1, 12) as series(month)
  ),
  decorated as (
    select
      mr.period_start,
      fee.amount_cents as scheduled_amount_cents,
      posted.amount_cents as paid_amount_cents,
      case
        when mr.period_start < billing_month_start then 'not_applicable'
        when posted.id is not null then 'paid'
        when fee.year is null then 'unconfigured'
        when mr.period_start > current_month_start then 'future'
        when mr.period_start < current_month_start then 'overdue'
        else 'pending'
      end as period_status
    from month_rows as mr
    left join public.payment_fee_schedule as fee
      on fee.year = mr.year
      and fee.month = mr.month
      and fee.status = 'active'
    left join public.payments as posted
      on posted.enrollment_id = enrollment_row.id
      and posted.year = mr.year
      and posted.month = mr.month
      and posted.status = 'posted'
  )
  select jsonb_build_object(
    'paidCount', count(*) filter (where period_status = 'paid'),
    'pendingCount', count(*) filter (where period_status = 'pending'),
    'overdueCount', count(*) filter (where period_status = 'overdue'),
    'futureCount', count(*) filter (where period_status = 'future'),
    'notApplicableCount', count(*) filter (where period_status = 'not_applicable'),
    'unconfiguredCount', count(*) filter (where period_status = 'unconfigured'),
    'totalDueCents', coalesce(sum(scheduled_amount_cents) filter (where period_status in ('pending', 'overdue')), 0),
    'totalPaidCents', coalesce(sum(paid_amount_cents) filter (where period_status = 'paid'), 0)
  )
  into summary
  from decorated;

  return jsonb_build_object(
    'ok', true,
    'elementId', element_row.id,
    'elementCode', element_row.element_code,
    'elementName', concat_ws(' ', element_row.given_names, element_row.paternal_surname, element_row.maternal_surname),
    'enrollmentId', enrollment_row.id,
    'enrollmentCode', enrollment_row.enrollment_code,
    'year', statement_year,
    'enrolledOn', enrollment_row.enrolled_on,
    'billingStartOn', enrollment_row.billing_start_on,
    'billingPolicy', enrollment_row.billing_policy,
    'summary', summary,
    'months', months
  );
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
      p.id as payment_id, p.payment_code, p.element_id, p.enrollment_id,
      p.year, p.month, p.amount_cents, p.currency, p.method, p.reference,
      p.status, p.version, p.recorded_at, p.cancelled_at, p.cancel_reason
    from public.payments as p
    where p.element_id = p_element_id and (p_year is null or p.year = p_year)
    order by p.year desc, p.month desc
    limit safe_limit
  ) as row_data;

  return jsonb_build_object('ok', true, 'elementId', p_element_id, 'items', items, 'limit', safe_limit);
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
  current_month_start date := date_trunc('month', now() at time zone 'America/Mexico_City')::date;
  active_elements integer;
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
  where e.status = 'active'
    and exists (
      select 1
      from public.element_enrollments as ee
      where ee.element_id = e.id
        and ee.status = 'active'
    );

  with active_enrollment_periods as (
    select
      ee.id as enrollment_id,
      pfs.year,
      pfs.month
    from public.element_enrollments as ee
    join public.elements as e on e.id = ee.element_id and e.status = 'active'
    join public.payment_fee_schedule as pfs
      on pfs.status = 'active'
      and make_date(pfs.year, pfs.month, 1) >= date_trunc('month', ee.billing_start_on)::date
      and make_date(pfs.year, pfs.month, 1) <= current_month_start
    where ee.status = 'active'
  ),
  unpaid_periods as (
    select ep.enrollment_id, ep.year, ep.month
    from active_enrollment_periods as ep
    left join public.payments as p
      on p.enrollment_id = ep.enrollment_id
      and p.year = ep.year
      and p.month = ep.month
      and p.status = 'posted'
    where p.id is null
  )
  select count(*)::integer
  into pending_payments
  from unpaid_periods;

  select count(*)::integer
  into attendance_today
  from public.attendance_records as a
  join public.elements as e on e.id = a.element_id
  where e.status = 'active'
    and a.record_status = 'active'
    and a.status in ('present', 'late')
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
  ) as activity;

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

revoke all on function public.create_element(text, text, text, date, text, text, text, text, text, text, date, text) from public, anon;
revoke all on function public.get_element(uuid) from public, anon;
revoke all on function public.deactivate_element(text, uuid, text, date) from public, anon;
revoke all on function public.record_payment(text, uuid, integer, integer, text, text) from public, anon;
revoke all on function public.list_payments(uuid, integer, integer) from public, anon;
revoke all on function public.get_element_payment_statement(uuid, integer) from public, anon;
revoke all on function public.get_dashboard_summary() from public, anon;

grant execute on function public.create_element(text, text, text, date, text, text, text, text, text, text, date, text) to authenticated, service_role;
grant execute on function public.get_element(uuid) to authenticated, service_role;
grant execute on function public.deactivate_element(text, uuid, text, date) to authenticated, service_role;
grant execute on function public.record_payment(text, uuid, integer, integer, text, text) to authenticated, service_role;
grant execute on function public.list_payments(uuid, integer, integer) to authenticated, service_role;
grant execute on function public.get_element_payment_statement(uuid, integer) to authenticated, service_role;
grant execute on function public.get_dashboard_summary() to authenticated, service_role;

comment on table public.element_enrollments is
  'Registration history for each canonical element/person. Re-entry creates a new active row instead of a duplicate element.';

comment on function public.deactivate_element(text, uuid, text, date) is
  'Closes the active enrollment and marks the element inactive without deleting history.';

commit;

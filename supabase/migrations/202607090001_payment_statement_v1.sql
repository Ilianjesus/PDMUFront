-- Payment statement rules for PDMU APP.
-- Adds per-element billing start dates and exposes a calculated account statement.

begin;

create or replace function public.calculate_billing_start_date(
  p_enrolled_on date,
  p_policy text default 'first_15_current_else_next'
)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  month_start date;
begin
  if p_enrolled_on is null then
    raise exception 'INVALID_ENROLLMENT_DATE' using errcode = '22023';
  end if;

  if coalesce(p_policy, 'first_15_current_else_next') <> 'first_15_current_else_next' then
    raise exception 'INVALID_BILLING_POLICY' using errcode = '22023';
  end if;

  month_start := date_trunc('month', p_enrolled_on)::date;

  if extract(day from p_enrolled_on)::integer <= 15 then
    return month_start;
  end if;

  return (month_start + interval '1 month')::date;
end;
$$;

alter table public.elements
  add column if not exists enrolled_on date,
  add column if not exists billing_start_on date,
  add column if not exists billing_policy text not null default 'first_15_current_else_next';

update public.elements
set
  enrolled_on = coalesce(enrolled_on, (created_at at time zone 'America/Mexico_City')::date),
  billing_policy = coalesce(nullif(btrim(billing_policy), ''), 'first_15_current_else_next');

update public.elements
set billing_start_on = coalesce(
  billing_start_on,
  public.calculate_billing_start_date(enrolled_on, billing_policy)
);

alter table public.elements
  alter column enrolled_on set not null,
  alter column billing_start_on set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'elements_billing_policy_check'
      and conrelid = 'public.elements'::regclass
  ) then
    alter table public.elements
      add constraint elements_billing_policy_check
      check (billing_policy in ('first_15_current_else_next'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'elements_billing_dates_check'
      and conrelid = 'public.elements'::regclass
  ) then
    alter table public.elements
      add constraint elements_billing_dates_check
      check (
        billing_start_on = public.calculate_billing_start_date(enrolled_on, billing_policy)
      );
  end if;
end;
$$;

create index if not exists elements_billing_status_idx
  on public.elements (status, billing_start_on);

create or replace function public.get_element(
  p_element_id uuid
)
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
      'enrolledOn', element_row.enrolled_on,
      'billingStartOn', element_row.billing_start_on,
      'billingPolicy', element_row.billing_policy,
      'status', element_row.status,
      'version', element_row.version,
      'createdAt', element_row.created_at,
      'updatedAt', element_row.updated_at
    ),
    'documents', documents
  );
end;
$$;

drop function if exists public.create_element(text, text, text, date, text, text, text, text, text, text);

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

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, after_data, request_id
  ) values (
    (select auth.uid()), 'element.created', 'element', created.id::text,
    jsonb_build_object(
      'elementCode', created.element_code,
      'status', created.status,
      'enrolledOn', created.enrolled_on,
      'billingStartOn', created.billing_start_on,
      'billingPolicy', created.billing_policy
    ),
    p_request_id
  );

  response := jsonb_build_object(
    'ok', true,
    'element', jsonb_build_object(
      'elementId', created.id,
      'elementCode', created.element_code,
      'status', created.status,
      'enrolledOn', created.enrolled_on,
      'billingStartOn', created.billing_start_on,
      'billingPolicy', created.billing_policy,
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
  element_row public.elements%rowtype;
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

  if period_start < date_trunc('month', element_row.billing_start_on)::date then
    raise exception 'PAYMENT_PERIOD_NOT_APPLICABLE' using errcode = '22023';
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

  billing_month_start := date_trunc('month', element_row.billing_start_on)::date;

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
      on posted.element_id = element_row.id
      and posted.year = mr.year
      and posted.month = mr.month
      and posted.status = 'posted'
    left join lateral (
      select c.*
      from public.payments as c
      where c.element_id = element_row.id
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
      on posted.element_id = element_row.id
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
    'year', statement_year,
    'enrolledOn', element_row.enrolled_on,
    'billingStartOn', element_row.billing_start_on,
    'billingPolicy', element_row.billing_policy,
    'summary', summary,
    'months', months
  );
end;
$$;

revoke all on function public.get_element_payment_statement(uuid, integer) from public, anon;
grant execute on function public.get_element_payment_statement(uuid, integer) to authenticated;
grant execute on function public.get_element_payment_statement(uuid, integer) to service_role;

grant execute on function public.create_element(
  text, text, text, date, text, text, text, text, text, text, date, text
) to authenticated;
grant execute on function public.create_element(
  text, text, text, date, text, text, text, text, text, text, date, text
) to service_role;

comment on function public.get_element_payment_statement(uuid, integer) is
  'Returns the calculated monthly account statement for an element using billing_start_on, payment_fee_schedule and payments.';

commit;

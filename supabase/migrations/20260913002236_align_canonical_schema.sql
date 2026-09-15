-- Reconcile the pre-existing remote project with the checked-in product schema.
-- Additive and idempotent: existing operational data is preserved.
begin;

CREATE OR REPLACE FUNCTION public.audit_element_document_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (
      actor_user_id,
      action,
      entity_type,
      entity_id,
      after_data
    ) values (
      (select auth.uid()),
      'element.document.uploaded',
      'element_document',
      new.id::text,
      jsonb_build_object(
        'elementId', new.element_id,
        'documentType', new.document_type,
        'status', new.status,
        'version', new.version
      )
    );
  elsif new.status is distinct from old.status then
    insert into public.audit_log (
      actor_user_id,
      action,
      entity_type,
      entity_id,
      before_data,
      after_data
    ) values (
      (select auth.uid()),
      'element.document.status_changed',
      'element_document',
      new.id::text,
      jsonb_build_object('status', old.status, 'version', old.version),
      jsonb_build_object('status', new.status, 'version', new.version)
    );
  end if;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.bootstrap_operator_profile() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  insert into public.operator_profiles (
    id,
    email,
    display_name,
    role,
    status
  ) values (
    new.id,
    coalesce(new.email, new.id::text || '@pending.local'),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), ''),
    case
      when new.raw_app_meta_data ->> 'pdmu_role' = 'admin' then 'admin'
      else 'operator'
    end,
    case
      when new.raw_app_meta_data ->> 'pdmu_status' = 'active' then 'active'
      else 'inactive'
    end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.calculate_element_group(p_birth_date date, p_sex_code text, p_reference_date date DEFAULT ((now() AT TIME ZONE 'America/Mexico_City'::text))::date) RETURNS text
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  normalized_sex text := lower(btrim(coalesce(p_sex_code, '')));
  age_years integer;
  sex_label text;
  category_label text;
begin
  if p_birth_date is null or normalized_sex = '' or p_birth_date > p_reference_date then
    return null;
  end if;

  sex_label := case
    when normalized_sex in ('f', 'femenino', 'femenil', 'femeni') then 'Femenil'
    when normalized_sex in ('m', 'masculino', 'varonil') then 'Varonil'
    else null
  end;

  if sex_label is null then
    return null;
  end if;

  age_years := date_part('year', age(p_reference_date::timestamp, p_birth_date::timestamp))::integer;
  category_label := case
    when age_years <= 12 then 'Menor'
    when age_years < 16 then 'Juvenil'
    else 'Mayor'
  end;

  return sex_label || ' ' || category_label;
end;
$$;

COMMENT ON FUNCTION public.calculate_element_group(p_birth_date date, p_sex_code text, p_reference_date date) IS 'Calculates Femenil/Varonil and Menor/Juvenil/Mayor from sex and current age. Thresholds: 0-12 Menor, 13-15 Juvenil, 16+ Mayor.';

CREATE OR REPLACE FUNCTION public.get_document_compliance_queue() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  response jsonb;
begin
  if coalesce((select auth.role()), '') <> 'service_role'
    and not public.is_admin_operator()
  then
    raise exception 'ADMIN_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  with required(document_type) as (
    values
      ('birth_certificate'::text),
      ('curp'::text),
      ('medical_certificate'::text),
      ('enrollment_form'::text),
      ('guardian_id'::text),
      ('proof_of_address'::text)
  ),
  compliance as (
    select
      e.id,
      btrim(concat_ws(' ', e.given_names, e.paternal_surname, e.maternal_surname)) as full_name,
      coalesce(
        jsonb_agg(r.document_type order by r.document_type)
          filter (where d.id is null),
        '[]'::jsonb
      ) as missing_documents
    from public.elements e
    cross join required r
    left join public.element_documents d
      on d.element_id = e.id
      and d.document_type = r.document_type
      and d.status = 'active'
    where e.status = 'active'
    group by e.id, e.given_names, e.paternal_surname, e.maternal_surname
    having count(d.id) < 6
  )
  select jsonb_build_object(
    'ok', true,
    'generatedAt', now(),
    'count', count(*),
    'elements', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'elementId', id,
          'fullName', full_name,
          'missingDocuments', missing_documents
        ) order by full_name
      ),
      '[]'::jsonb
    )
  )
  into response
  from compliance;

  return response;
end;
$$;

CREATE OR REPLACE FUNCTION public.get_operational_statistics(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_branch text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_activity text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  today_mx date := (now() at time zone 'America/Mexico_City')::date;
  date_from date := coalesce(p_from, date_trunc('month', now() at time zone 'America/Mexico_City')::date);
  date_to date := coalesce(
    p_to,
    (date_trunc('month', now() at time zone 'America/Mexico_City') + interval '1 month - 1 day')::date
  );
  branch_filter text := nullif(lower(btrim(coalesce(p_branch, ''))), '');
  category_filter text := nullif(lower(btrim(coalesce(p_category, ''))), '');
  activity_filter text := nullif(translate(lower(btrim(coalesce(p_activity, ''))), 'áéíóúüñ', 'aeiouun'), '');
  date_from_month date := date_trunc('month', date_from)::date;
  date_to_month date := date_trunc('month', date_to)::date;
  result jsonb;
begin
  if not public.is_active_operator() then
    raise exception 'ACTIVE_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  if date_from > date_to or date_to - date_from > 366 then
    raise exception 'INVALID_STATISTICS_RANGE' using errcode = '22023';
  end if;

  with filtered_elements as (
    select
      e.id,
      e.given_names,
      e.paternal_surname,
      e.maternal_surname,
      concat_ws(' ', e.given_names, e.paternal_surname, e.maternal_surname) as display_name,
      e.birth_date,
      e.sex_code,
      public.calculate_element_group(e.birth_date, e.sex_code) as group_label
    from public.elements as e
    where e.status = 'active'
      and exists (
        select 1
        from public.element_enrollments as ee
        where ee.element_id = e.id
          and ee.status = 'active'
      )
      and (
        branch_filter is null
        or lower(public.calculate_element_group(e.birth_date, e.sex_code)) like '%' || branch_filter || '%'
      )
      and (
        category_filter is null
        or lower(public.calculate_element_group(e.birth_date, e.sex_code)) like '%' || category_filter || '%'
      )
  ),
  active_enrollments as (
    select
      ee.id,
      ee.element_id,
      ee.enrolled_on,
      ee.billing_start_on
    from public.element_enrollments as ee
    join filtered_elements as fe on fe.id = ee.element_id
    where ee.status = 'active'
  ),
  filtered_sessions as (
    select
      s.id,
      s.activity_id,
      s.session_date,
      s.attendance_required,
      a.name as activity_name,
      a.category
    from public.activity_sessions as s
    join public.attendance_activities as a on a.id = s.activity_id
    where s.status <> 'cancelled'
      and s.session_date between date_from and date_to
      and (
        activity_filter is null
        or (
          activity_filter = 'personalizado'
          and a.category = 'event'
        )
        or (
          activity_filter = 'instruccion'
          and translate(lower(a.name), 'áéíóúüñ', 'aeiouun') in ('instruccion', 'entrenamiento obligatorio')
        )
        or translate(lower(a.name), 'áéíóúüñ', 'aeiouun') = activity_filter
      )
  ),
  attendance_registered as (
    select ar.*
    from public.attendance_records as ar
    join filtered_elements as fe on fe.id = ar.element_id
    left join public.activity_sessions as s on s.id = ar.session_id
    left join public.attendance_activities as a on a.id = s.activity_id
    where ar.record_status = 'active'
      and ar.attendance_date between date_from and date_to
      and (
        activity_filter is null
        or (
          activity_filter = 'personalizado'
          and a.category = 'event'
        )
        or (
          activity_filter = 'instruccion'
          and translate(lower(coalesce(a.name, '')), 'áéíóúüñ', 'aeiouun') in ('instruccion', 'entrenamiento obligatorio')
        )
        or translate(lower(coalesce(a.name, '')), 'áéíóúüñ', 'aeiouun') = activity_filter
      )
  ),
  expected_required as (
    select
      fe.id as element_id,
      fe.display_name,
      fe.group_label,
      fs.id as session_id,
      fs.session_date,
      fs.activity_name,
      ar.id as attendance_id,
      ar.status as attendance_status,
      ex.id as exception_id
    from filtered_sessions as fs
    join active_enrollments as ae on ae.enrolled_on <= fs.session_date
    join filtered_elements as fe on fe.id = ae.element_id
    left join public.attendance_records as ar
      on ar.session_id = fs.id
      and ar.element_id = fe.id
      and ar.record_status = 'active'
    left join public.element_attendance_exceptions as ex
      on ex.element_id = fe.id
      and ex.status = 'active'
      and (
        (
          ex.scope = 'session'
          and ex.session_id = fs.id
        )
        or (
          ex.scope = 'weekday'
          and ex.weekday = extract(dow from fs.session_date)::integer
          and ex.starts_on <= fs.session_date
          and (ex.ends_on is null or ex.ends_on >= fs.session_date)
        )
        or (
          ex.scope = 'date_range'
          and ex.starts_on <= fs.session_date
          and (ex.ends_on is null or ex.ends_on >= fs.session_date)
        )
      )
    where fs.attendance_required = true
  ),
  attendance_attention as (
    select
      er.element_id,
      er.display_name,
      er.group_label,
      count(*)::integer as required_count,
      count(*) filter (where er.attendance_status in ('present', 'late'))::integer as present_count,
      count(*) filter (where er.attendance_status = 'excused' or er.exception_id is not null)::integer as excused_count,
      count(*) filter (
        where er.exception_id is null
          and (er.attendance_id is null or er.attendance_status = 'absent')
      )::integer as absence_count
    from expected_required as er
    group by er.element_id, er.display_name, er.group_label
  ),
  payment_periods as (
    select
      fe.id as element_id,
      fe.display_name,
      fe.group_label,
      ae.id as enrollment_id,
      period_start::date as period_start,
      extract(year from period_start)::integer as year,
      extract(month from period_start)::integer as month
    from filtered_elements as fe
    join active_enrollments as ae on ae.element_id = fe.id
    cross join lateral generate_series(
      greatest(date_trunc('month', ae.billing_start_on)::date, date_from_month),
      date_to_month,
      interval '1 month'
    ) as period_start
    where ae.billing_start_on <= date_to
  ),
  payment_attention_base as (
    select
      pp.element_id,
      pp.display_name,
      pp.group_label,
      count(*) filter (where p.id is null and fee.id is not null)::integer as pending_months,
      coalesce(sum(fee.amount_cents) filter (where p.id is null and fee.id is not null), 0)::integer as due_cents
    from payment_periods as pp
    left join public.payment_fee_schedule as fee
      on fee.year = pp.year
      and fee.month = pp.month
      and fee.status = 'active'
    left join public.payments as p
      on p.enrollment_id = pp.enrollment_id
      and p.year = pp.year
      and p.month = pp.month
      and p.status = 'posted'
    group by pp.element_id, pp.display_name, pp.group_label
  ),
  last_payments as (
    select
      p.element_id,
      max(p.recorded_at) as last_payment_at
    from public.payments as p
    join filtered_elements as fe on fe.id = p.element_id
    where p.status = 'posted'
    group by p.element_id
  ),
  payment_attention as (
    select
      pab.element_id,
      pab.display_name,
      pab.group_label,
      pab.pending_months,
      pab.due_cents,
      lp.last_payment_at
    from payment_attention_base as pab
    left join last_payments as lp on lp.element_id = pab.element_id
  ),
  months as (
    select generate_series(date_from_month, date_to_month, interval '1 month')::date as month_start
  ),
  monthly_trend as (
    select
      m.month_start,
      extract(year from m.month_start)::integer as year,
      extract(month from m.month_start)::integer as month,
      (
        select count(*)::integer
        from public.element_enrollments as ee
        join filtered_elements as fe on fe.id = ee.element_id
        where ee.enrolled_on >= m.month_start
          and ee.enrolled_on < (m.month_start + interval '1 month')::date
      ) as enrollments_count,
      (
        select count(*)::integer
        from public.payments as p
        join filtered_elements as fe on fe.id = p.element_id
        where p.status = 'posted'
          and p.recorded_at >= m.month_start
          and p.recorded_at < (m.month_start + interval '1 month')::date
      ) as payments_count,
      (
        select coalesce(sum(p.amount_cents), 0)::integer
        from public.payments as p
        join filtered_elements as fe on fe.id = p.element_id
        where p.status = 'posted'
          and p.recorded_at >= m.month_start
          and p.recorded_at < (m.month_start + interval '1 month')::date
      ) as payments_cents,
      (
        select count(*)::integer
        from attendance_registered as ar
        where ar.attendance_date >= m.month_start
          and ar.attendance_date < (m.month_start + interval '1 month')::date
      ) as attendance_count
    from months as m
  )
  select jsonb_build_object(
    'ok', true,
    'period', jsonb_build_object(
      'from', date_from,
      'to', date_to
    ),
    'filters', jsonb_build_object(
      'branch', branch_filter,
      'category', category_filter,
      'activity', activity_filter
    ),
    'summary', jsonb_build_object(
      'activeElements', (select count(*) from filtered_elements),
      'newEnrollments', (
        select count(*)
        from active_enrollments
        where enrolled_on between date_from and date_to
      ),
      'pendingPayments', coalesce((select sum(pending_months) from payment_attention), 0),
      'pendingAmountCents', coalesce((select sum(due_cents) from payment_attention), 0),
      'attendanceRegistered', (select count(*) from attendance_registered),
      'requiredAbsences', coalesce((select sum(absence_count) from attendance_attention), 0)
    ),
    'attendanceAttention', coalesce((
      select jsonb_agg(jsonb_build_object(
        'elementId', aa.element_id,
        'displayName', aa.display_name,
        'groupLabel', aa.group_label,
        'requiredCount', aa.required_count,
        'presentCount', aa.present_count,
        'excusedCount', aa.excused_count,
        'absenceCount', aa.absence_count
      ) order by absence_count desc, display_name)
      from (
        select *
        from attendance_attention
        where absence_count > 0
        order by absence_count desc, display_name
        limit 25
      ) as aa
    ), '[]'::jsonb),
    'paymentAttention', coalesce((
      select jsonb_agg(jsonb_build_object(
        'elementId', pa.element_id,
        'displayName', pa.display_name,
        'groupLabel', pa.group_label,
        'pendingMonths', pa.pending_months,
        'dueCents', pa.due_cents,
        'lastPaymentAt', pa.last_payment_at
      ) order by pending_months desc, due_cents desc, display_name)
      from (
        select *
        from payment_attention
        where pending_months > 0
        order by pending_months desc, due_cents desc, display_name
        limit 25
      ) as pa
    ), '[]'::jsonb),
    'monthlyTrend', coalesce((
      select jsonb_agg(jsonb_build_object(
        'year', year,
        'month', month,
        'enrollmentsCount', enrollments_count,
        'paymentsCount', payments_count,
        'paymentsCents', payments_cents,
        'attendanceCount', attendance_count
      ) order by month_start)
      from monthly_trend
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

COMMENT ON FUNCTION public.get_operational_statistics(p_from date, p_to date, p_branch text, p_category text, p_activity text) IS 'Returns consolidated operational statistics for elements, payments and attendance with optional branch/category/activity filters.';

CREATE OR REPLACE FUNCTION public.get_operations_digest() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  local_today date := (now() at time zone 'America/Mexico_City')::date;
  local_year integer := extract(year from (now() at time zone 'America/Mexico_City'))::integer;
  local_month integer := extract(month from (now() at time zone 'America/Mexico_City'))::integer;
  active_elements_count integer;
  pending_payments_count integer;
  elements_with_missing_documents_count integer;
  sessions_to_review_count integer;
  admin_recipients jsonb;
begin
  if coalesce((select auth.role()), '') <> 'service_role'
    and not public.is_admin_operator()
  then
    raise exception 'ADMIN_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  select count(*)::integer
  into active_elements_count
  from public.elements e
  where e.status = 'active';

  select count(*)::integer
  into pending_payments_count
  from public.elements e
  where e.status = 'active'
    and coalesce(e.billing_start_on, e.enrolled_on, e.created_at::date)
      <= make_date(local_year, local_month, 1)
    and not exists (
      select 1
      from public.payments p
      where p.element_id = e.id
        and p.year = local_year
        and p.month = local_month
        and p.status = 'posted'
    );

  select count(*)::integer
  into elements_with_missing_documents_count
  from public.elements e
  where e.status = 'active'
    and (
      select count(distinct d.document_type)
      from public.element_documents d
      where d.element_id = e.id
        and d.status = 'active'
        and d.document_type in (
          'birth_certificate',
          'curp',
          'medical_certificate',
          'enrollment_form',
          'guardian_id',
          'proof_of_address'
        )
    ) < 6;

  select count(*)::integer
  into sessions_to_review_count
  from public.activity_sessions s
  where s.session_date <= local_today
    and s.status in ('scheduled', 'open');

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'email', op.email,
        'displayName', coalesce(op.display_name, op.email)
      ) order by op.email
    ),
    '[]'::jsonb
  )
  into admin_recipients
  from public.operator_profiles op
  where op.role = 'admin'
    and op.status = 'active';

  return jsonb_build_object(
    'ok', true,
    'generatedAt', now(),
    'date', local_today,
    'summary', jsonb_build_object(
      'activeElements', active_elements_count,
      'pendingPayments', pending_payments_count,
      'elementsWithMissingDocuments', elements_with_missing_documents_count,
      'sessionsToReview', sessions_to_review_count
    ),
    'recipients', admin_recipients
  );
end;
$$;

CREATE OR REPLACE FUNCTION public.protect_last_active_admin() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if old.role = 'admin'
    and old.status = 'active'
    and (new.role <> 'admin' or new.status <> 'active')
    and not exists (
      select 1
      from public.operator_profiles op
      where op.id <> old.id
        and op.role = 'admin'
        and op.status = 'active'
    )
  then
    raise exception 'LAST_ACTIVE_ADMIN_REQUIRED' using errcode = '23514';
  end if;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.purge_expired_idempotency_keys() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  deleted_count integer;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;

  delete from public.idempotency_keys
  where expires_at < now();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

CREATE OR REPLACE FUNCTION public.register_element_document(p_request_id text, p_element_id uuid, p_document_type text, p_storage_key text, p_original_filename text, p_mime_type text, p_size_bytes bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  request_hash text;
  replay jsonb;
  current_document public.element_documents%rowtype;
  created_document public.element_documents%rowtype;
  response jsonb;
begin
  if not public.is_admin_operator() then
    raise exception 'ADMIN_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  if p_element_id is null
    or nullif(btrim(p_document_type), '') is null
    or nullif(btrim(p_storage_key), '') is null
    or nullif(btrim(p_original_filename), '') is null
    or p_mime_type <> 'application/pdf'
    or p_size_bytes is null
    or p_size_bytes <= 0
    or p_size_bytes > 10485760
  then
    raise exception 'INVALID_DOCUMENT' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.elements e where e.id = p_element_id
  ) then
    raise exception 'ELEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  request_hash := 'sha256:' || encode(extensions.digest(jsonb_build_object(
    'elementId', p_element_id,
    'documentType', btrim(p_document_type),
    'storageKey', btrim(p_storage_key),
    'originalFilename', btrim(p_original_filename),
    'mimeType', p_mime_type,
    'sizeBytes', p_size_bytes
  )::text, 'sha256'), 'hex');

  replay := public._frontend_claim_request(
    p_request_id,
    'element.document.register',
    request_hash
  );
  if replay is not null then
    return replay;
  end if;

  select * into current_document
  from public.element_documents d
  where d.element_id = p_element_id
    and d.document_type = btrim(p_document_type)
    and d.status = 'active'
  for update;

  if found then
    update public.element_documents
    set status = 'replaced', replaced_at = now()
    where id = current_document.id;
  end if;

  insert into public.element_documents (
    element_id,
    document_type,
    drive_file_id,
    original_filename,
    mime_type,
    size_bytes,
    status,
    version,
    replaces_document_id
  ) values (
    p_element_id,
    btrim(p_document_type),
    btrim(p_storage_key),
    btrim(p_original_filename),
    p_mime_type,
    p_size_bytes,
    'active',
    coalesce(current_document.version, 0) + 1,
    current_document.id
  )
  returning * into created_document;

  response := jsonb_build_object(
    'ok', true,
    'document', jsonb_build_object(
      'documentId', created_document.id,
      'elementId', created_document.element_id,
      'documentType', created_document.document_type,
      'status', created_document.status,
      'version', created_document.version,
      'uploadedAt', created_document.uploaded_at
    )
  );

  perform public._frontend_complete_request(p_request_id, response, 201);
  return response;
end;
$$;

-- The two private document buckets are part of the application contract.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('element-documents', 'element-documents', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Both triggers are absent from the existing remote schema.
do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'auth_user_bootstrap_operator_profile') then
    create trigger auth_user_bootstrap_operator_profile after insert on auth.users
      for each row execute function public.bootstrap_operator_profile();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.element_documents'::regclass and tgname = 'element_documents_audit_change') then
    create trigger element_documents_audit_change after insert or update on public.element_documents
      for each row execute function public.audit_element_document_change();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.operator_profiles'::regclass and tgname = 'operator_profiles_protect_last_admin') then
    create trigger operator_profiles_protect_last_admin before update of role, status on public.operator_profiles
      for each row execute function public.protect_last_active_admin();
  end if;
end;
$$;

-- Storage is private to administrators, with matching read/write policies.
drop policy if exists element_documents_storage_select_admin on storage.objects;
create policy element_documents_storage_select_admin on storage.objects for select to authenticated
  using (bucket_id = 'element-documents' and (select public.is_admin_operator()));
drop policy if exists element_documents_storage_insert_admin on storage.objects;
create policy element_documents_storage_insert_admin on storage.objects for insert to authenticated
  with check (bucket_id = 'element-documents' and (select public.is_admin_operator()));
drop policy if exists element_documents_storage_update_admin on storage.objects;
create policy element_documents_storage_update_admin on storage.objects for update to authenticated
  using (bucket_id = 'element-documents' and (select public.is_admin_operator()))
  with check (bucket_id = 'element-documents' and (select public.is_admin_operator()));
drop policy if exists element_documents_storage_delete_admin on storage.objects;
create policy element_documents_storage_delete_admin on storage.objects for delete to authenticated
  using (bucket_id = 'element-documents' and (select public.is_admin_operator()));

-- PUBLIC is an implicit grant to anon and authenticated. Internal helpers are not APIs.
revoke all on function public.audit_element_document_change() from public, anon, authenticated;
revoke all on function public.audit_element_profile_update() from public, anon, authenticated;
revoke all on function public.bootstrap_operator_profile() from public, anon, authenticated;
revoke all on function public.protect_last_active_admin() from public, anon, authenticated;
revoke all on function public.find_matching_element(text, text, text, date) from public, anon, authenticated;
revoke all on function public.get_active_element_enrollment(uuid) from public, anon, authenticated;
revoke all on function public.is_element_exempt_from_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.purge_expired_idempotency_keys() from public, anon, authenticated;
grant execute on function public.purge_expired_idempotency_keys() to service_role;

revoke all on function public.calculate_element_group(date, text, date) from public, anon;
grant execute on function public.calculate_element_group(date, text, date) to authenticated, service_role;
revoke all on function public.get_document_compliance_queue() from public, anon;
grant execute on function public.get_document_compliance_queue() to authenticated, service_role;
revoke all on function public.get_operational_statistics(date, date, text, text, text) from public, anon;
grant execute on function public.get_operational_statistics(date, date, text, text, text) to authenticated, service_role;
revoke all on function public.get_operations_digest() from public, anon;
grant execute on function public.get_operations_digest() to authenticated, service_role;
revoke all on function public.register_element_document(text, uuid, text, text, text, text, bigint) from public, anon;
grant execute on function public.register_element_document(text, uuid, text, text, text, text, bigint) to authenticated, service_role;
revoke all on function public.complete_element_assets(text, uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.complete_element_assets(text, uuid, text, text, text, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;

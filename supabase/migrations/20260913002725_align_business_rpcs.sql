-- Replace older remote RPC bodies with the canonical, locally tested versions.
-- Group is derived from sex and age at read time; group_code remains historical input.
begin;

CREATE OR REPLACE FUNCTION public.create_activity_session(p_activity_id uuid, p_session_date date, p_starts_at time without time zone DEFAULT NULL::time without time zone, p_ends_at time without time zone DEFAULT NULL::time without time zone, p_location text DEFAULT NULL::text, p_attendance_scope text DEFAULT 'open'::text, p_attendance_required boolean DEFAULT false, p_status text DEFAULT 'scheduled'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  activity_row public.attendance_activities%rowtype;
  row_data public.activity_sessions%rowtype;
begin
  if not public.is_admin_operator() then
    raise exception 'ADMIN_OPERATOR_REQUIRED' using errcode = '42501';
  end if;
  if p_session_date is null then
    raise exception 'INVALID_SESSION_DATE' using errcode = '22023';
  end if;
  if p_attendance_scope not in ('all_active', 'enrolled', 'open') then
    raise exception 'INVALID_ATTENDANCE_SCOPE' using errcode = '22023';
  end if;
  if p_status not in ('scheduled', 'open', 'closed', 'cancelled') then
    raise exception 'INVALID_SESSION_STATUS' using errcode = '22023';
  end if;

  select * into activity_row
  from public.attendance_activities
  where id = p_activity_id;
  if not found then
    raise exception 'ACTIVITY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if activity_row.status <> 'active' then
    raise exception 'ACTIVITY_INACTIVE' using errcode = '55000';
  end if;

  select * into row_data
  from public.activity_sessions
  where activity_id = p_activity_id
    and session_date = p_session_date
    and status <> 'cancelled'
  order by created_at asc, id asc
  limit 1;

  if not found then
    insert into public.activity_sessions (
      activity_id, session_date, starts_at, ends_at, location,
      attendance_scope, attendance_required, status
    ) values (
      p_activity_id, p_session_date, p_starts_at, p_ends_at,
      nullif(btrim(p_location), ''), p_attendance_scope, p_attendance_required,
      p_status
    ) returning * into row_data;
  end if;

  return jsonb_build_object('ok', true, 'session', jsonb_build_object(
    'sessionId', row_data.id,
    'activityId', row_data.activity_id,
    'activityName', activity_row.name,
    'category', activity_row.category,
    'sessionDate', row_data.session_date,
    'startsAt', row_data.starts_at,
    'endsAt', row_data.ends_at,
    'location', row_data.location,
    'attendanceScope', row_data.attendance_scope,
    'attendanceRequired', row_data.attendance_required,
    'status', row_data.status
  ));
end;
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_summary() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  today_mx date := (now() at time zone 'America/Mexico_City')::date;
  current_year integer := extract(year from (now() at time zone 'America/Mexico_City'))::integer;
  current_month integer := extract(month from (now() at time zone 'America/Mexico_City'))::integer;
  current_month_start date := date_trunc('month', now() at time zone 'America/Mexico_City')::date;
  active_elements integer;
  pending_payments integer;
  attendance_today integer;
  documents_pending integer;
  important_alerts jsonb := '[]'::jsonb;
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
      current_year as year,
      current_month as month
    from public.element_enrollments as ee
    join public.elements as e on e.id = ee.element_id and e.status = 'active'
    where ee.status = 'active'
      and date_trunc('month', ee.billing_start_on)::date <= current_month_start
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
      pending_payments::text || ' mensualidad(es) pendiente(s) de ' || current_month::text || '/' || current_year::text || '.'
    );
  end if;

  if documents_pending > 0 then
    important_alerts := important_alerts || jsonb_build_array(
      documents_pending::text || ' expediente(s) con documentación incompleta.'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'resumenRapido', jsonb_build_object(
      'elementosActivos', active_elements,
      'pagosPendientes', pending_payments,
      'asistenciasHoy', attendance_today
    ),
    'alertasImportantes', important_alerts,
    'actividadReciente', '[]'::jsonb
  );
end;
$$;

COMMENT ON FUNCTION public.get_dashboard_summary() IS 'Returns the home dashboard metrics: active elements, current-month pending payments, today attendance, and important alerts.';

CREATE OR REPLACE FUNCTION public.get_element(p_element_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
      'groupCode', public.calculate_element_group(element_row.birth_date, element_row.sex_code),
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

CREATE OR REPLACE FUNCTION public.search_elements(p_query text, p_limit integer DEFAULT 20, p_status text DEFAULT 'active'::text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
      e.given_names,
      e.paternal_surname,
      e.maternal_surname,
      concat_ws(' ', e.given_names, e.paternal_surname, e.maternal_surname) as display_name,
      e.birth_date,
      e.sex_code,
      public.calculate_element_group(e.birth_date, e.sex_code) as group_code,
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

notify pgrst, 'reload schema';
commit;

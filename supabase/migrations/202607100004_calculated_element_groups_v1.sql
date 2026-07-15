create or replace function public.calculate_element_group(
  p_birth_date date,
  p_sex_code text,
  p_reference_date date default ((now() at time zone 'America/Mexico_City')::date)
)
returns text
language plpgsql
stable
set search_path = ''
as $$
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

update public.elements as e
set group_code = public.calculate_element_group(e.birth_date, e.sex_code)
where public.calculate_element_group(e.birth_date, e.sex_code) is not null
  and e.group_code is distinct from public.calculate_element_group(e.birth_date, e.sex_code);

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

revoke all on function public.calculate_element_group(date, text, date) from public, anon;
revoke all on function public.search_elements(text, integer, text) from public, anon;
revoke all on function public.get_element(uuid) from public, anon;

grant execute on function public.calculate_element_group(date, text, date) to authenticated, service_role;
grant execute on function public.search_elements(text, integer, text) to authenticated, service_role;
grant execute on function public.get_element(uuid) to authenticated, service_role;

comment on function public.calculate_element_group(date, text, date) is
  'Calculates Femenil/Varonil and Menor/Juvenil/Mayor from sex and current age. Thresholds: 0-12 Menor, 13-15 Juvenil, 16+ Mayor.';

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE SCHEMA IF NOT EXISTS public;

COMMENT ON SCHEMA public IS 'standard public schema';

CREATE FUNCTION public._frontend_claim_request(p_request_id text, p_action text, p_request_hash text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public._frontend_complete_request(p_request_id text, p_response jsonb, p_response_status integer DEFAULT 200) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.audit_element_document_change() RETURNS trigger
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

CREATE FUNCTION public.audit_element_profile_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  changed_fields text[] := array[]::text[];
begin
  if new.given_names is distinct from old.given_names then
    changed_fields := array_append(changed_fields, 'givenNames');
  end if;
  if new.paternal_surname is distinct from old.paternal_surname then
    changed_fields := array_append(changed_fields, 'paternalSurname');
  end if;
  if new.maternal_surname is distinct from old.maternal_surname then
    changed_fields := array_append(changed_fields, 'maternalSurname');
  end if;
  if new.birth_date is distinct from old.birth_date then
    changed_fields := array_append(changed_fields, 'birthDate');
  end if;
  if new.sex_code is distinct from old.sex_code then
    changed_fields := array_append(changed_fields, 'sexCode');
  end if;
  if new.group_code is distinct from old.group_code then
    changed_fields := array_append(changed_fields, 'groupCode');
  end if;
  if new.medical_notes is distinct from old.medical_notes then
    changed_fields := array_append(changed_fields, 'medicalNotes');
  end if;
  if new.guardian_name is distinct from old.guardian_name then
    changed_fields := array_append(changed_fields, 'guardianName');
  end if;
  if new.guardian_phone is distinct from old.guardian_phone then
    changed_fields := array_append(changed_fields, 'guardianPhone');
  end if;
  if new.is_self_tutor is distinct from old.is_self_tutor then
    changed_fields := array_append(changed_fields, 'isSelfTutor');
  end if;

  if cardinality(changed_fields) > 0 then
    insert into public.audit_log (
      actor_user_id,
      action,
      entity_type,
      entity_id,
      before_data,
      after_data
    ) values (
      (select auth.uid()),
      'element.profile.updated',
      'element',
      new.id::text,
      jsonb_build_object('version', old.version),
      jsonb_build_object(
        'version', new.version,
        'changedFields', to_jsonb(changed_fields),
        'isSelfTutor', new.is_self_tutor
      )
    );
  end if;

  return new;
end;
$$;

CREATE FUNCTION public.bootstrap_operator_profile() RETURNS trigger
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

CREATE FUNCTION public.calculate_billing_start_date(p_enrolled_on date, p_policy text DEFAULT 'first_15_current_else_next'::text) RETURNS date
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.calculate_element_group(p_birth_date date, p_sex_code text, p_reference_date date DEFAULT ((now() AT TIME ZONE 'America/Mexico_City'::text))::date) RETURNS text
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

CREATE FUNCTION public.cancel_attendance(p_request_id text, p_attendance_id uuid, p_expected_version integer, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.cancel_payment(p_request_id text, p_payment_id uuid, p_expected_version integer, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.complete_element_assets(p_request_id text, p_element_id uuid, p_drive_folder_id text, p_drive_folder_url text, p_qr_value text, p_documents jsonb DEFAULT '[]'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  request_hash text;
  replay jsonb;
  document_payload jsonb;
  current_document public.element_documents%rowtype;
  created_document public.element_documents%rowtype;
  v_document_type text;
  v_drive_file_id text;
  v_drive_url text;
  v_original_filename text;
  v_mime_type text;
  v_size_bytes bigint;
  saved_documents jsonb := '[]'::jsonb;
  response jsonb;
begin
  if not public.is_active_operator() then
    raise exception 'ACTIVE_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  if p_element_id is null
    or nullif(btrim(p_request_id), '') is null
    or nullif(btrim(p_drive_folder_id), '') is null
    or nullif(btrim(p_drive_folder_url), '') is null
    or nullif(btrim(p_qr_value), '') is null
    or jsonb_typeof(coalesce(p_documents, '[]'::jsonb)) <> 'array'
  then
    raise exception 'INVALID_ELEMENT_ASSETS' using errcode = '22023';
  end if;

  if not exists (select 1 from public.elements where id = p_element_id) then
    raise exception 'ELEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  request_hash := 'sha256:' || encode(extensions.digest(jsonb_build_object(
    'elementId', p_element_id,
    'driveFolderId', btrim(p_drive_folder_id),
    'driveFolderUrl', btrim(p_drive_folder_url),
    'qrValue', btrim(p_qr_value),
    'documents', coalesce(p_documents, '[]'::jsonb)
  )::text, 'sha256'), 'hex');

  replay := public._frontend_claim_request(
    p_request_id,
    'element.assets.complete',
    request_hash
  );
  if replay is not null then
    return replay;
  end if;

  update public.elements
  set
    drive_folder_id = btrim(p_drive_folder_id),
    drive_folder_url = btrim(p_drive_folder_url),
    qr_value = btrim(p_qr_value)
  where id = p_element_id;

  for document_payload in
    select value from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb))
  loop
    v_document_type := btrim(coalesce(document_payload ->> 'type', ''));
    v_drive_file_id := btrim(coalesce(document_payload ->> 'fileId', ''));
    v_drive_url := btrim(coalesce(document_payload ->> 'url', ''));
    v_original_filename := btrim(coalesce(
      document_payload ->> 'originalFilename',
      document_payload ->> 'fileName',
      'documento.pdf'
    ));
    v_mime_type := btrim(coalesce(document_payload ->> 'mimeType', 'application/pdf'));
    v_size_bytes := coalesce((document_payload ->> 'sizeBytes')::bigint, 1);

    if v_document_type not in (
      'birth_certificate',
      'curp',
      'medical_certificate',
      'enrollment_form',
      'guardian_id',
      'proof_of_address'
    )
      or v_drive_file_id = ''
      or v_drive_url = ''
      or v_original_filename = ''
      or v_mime_type <> 'application/pdf'
      or v_size_bytes <= 0
      or v_size_bytes > 10485760
    then
      raise exception 'INVALID_DOCUMENT' using errcode = '22023';
    end if;

    select * into current_document
    from public.element_documents d
    where d.element_id = p_element_id
      and d.document_type = v_document_type
      and d.status = 'active'
    for update;

    if found and current_document.drive_file_id = v_drive_file_id then
      update public.element_documents
      set
        drive_url = v_drive_url,
        original_filename = v_original_filename,
        mime_type = v_mime_type,
        size_bytes = v_size_bytes
      where id = current_document.id
      returning * into created_document;
    else
      if found then
        update public.element_documents
        set status = 'replaced', replaced_at = now()
        where id = current_document.id;
      end if;

      insert into public.element_documents (
        element_id,
        document_type,
        drive_file_id,
        drive_url,
        original_filename,
        mime_type,
        size_bytes,
        status,
        version,
        replaces_document_id
      ) values (
        p_element_id,
        v_document_type,
        v_drive_file_id,
        v_drive_url,
        v_original_filename,
        v_mime_type,
        v_size_bytes,
        'active',
        coalesce(current_document.version, 0) + 1,
        current_document.id
      )
      returning * into created_document;
    end if;

    saved_documents := saved_documents || jsonb_build_array(jsonb_build_object(
      'documentId', created_document.id,
      'type', created_document.document_type,
      'fileId', created_document.drive_file_id,
      'url', created_document.drive_url,
      'version', created_document.version
    ));
  end loop;

  response := jsonb_build_object(
    'ok', true,
    'elementId', p_element_id,
    'driveFolder', jsonb_build_object(
      'id', btrim(p_drive_folder_id),
      'url', btrim(p_drive_folder_url)
    ),
    'qr', jsonb_build_object('value', btrim(p_qr_value)),
    'documents', saved_documents
  );

  perform public._frontend_complete_request(p_request_id, response, 200);
  return response;
end;
$$;

CREATE FUNCTION public.create_activity_session(p_activity_id uuid, p_session_date date, p_starts_at time without time zone DEFAULT NULL::time without time zone, p_ends_at time without time zone DEFAULT NULL::time without time zone, p_location text DEFAULT NULL::text, p_attendance_scope text DEFAULT 'open'::text, p_attendance_required boolean DEFAULT false, p_status text DEFAULT 'scheduled'::text) RETURNS jsonb
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

CREATE FUNCTION public.create_attendance_exception(p_element_id uuid, p_scope text, p_reason text, p_weekday integer DEFAULT NULL::integer, p_session_id uuid DEFAULT NULL::uuid, p_starts_on date DEFAULT NULL::date, p_ends_on date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  row_data public.element_attendance_exceptions%rowtype;
begin
  if not public.is_admin_operator() then
    raise exception 'ADMIN_OPERATOR_REQUIRED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.elements where id = p_element_id) then
    raise exception 'ELEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'CANCEL_REASON_REQUIRED' using errcode = '22023';
  end if;

  insert into public.element_attendance_exceptions (
    element_id, scope, weekday, session_id, starts_on, ends_on,
    reason, status, created_by
  ) values (
    p_element_id, p_scope, p_weekday, p_session_id,
    coalesce(p_starts_on, (now() at time zone 'America/Mexico_City')::date),
    p_ends_on, btrim(p_reason), 'active', (select auth.uid())
  ) returning * into row_data;

  return jsonb_build_object('ok', true, 'exception', jsonb_build_object(
    'exceptionId', row_data.id,
    'elementId', row_data.element_id,
    'scope', row_data.scope,
    'weekday', row_data.weekday,
    'sessionId', row_data.session_id,
    'startsOn', row_data.starts_on,
    'endsOn', row_data.ends_on,
    'reason', row_data.reason,
    'status', row_data.status
  ));
end;
$$;

CREATE FUNCTION public.create_element(p_request_id text, p_given_names text, p_paternal_surname text, p_birth_date date, p_sex_code text, p_guardian_name text, p_guardian_phone text, p_maternal_surname text DEFAULT NULL::text, p_group_code text DEFAULT NULL::text, p_medical_notes text DEFAULT NULL::text, p_enrolled_on date DEFAULT NULL::date, p_billing_policy text DEFAULT 'first_15_current_else_next'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;

SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE public.operator_profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    display_name text,
    role text DEFAULT 'operator'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operator_profiles_email_not_blank CHECK ((btrim(email) <> ''::text)),
    CONSTRAINT operator_profiles_role_check CHECK ((role = ANY (ARRAY['operator'::text, 'admin'::text]))),
    CONSTRAINT operator_profiles_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);

COMMENT ON TABLE public.operator_profiles IS 'Internal operator profile linked one-to-one with auth.users.';

CREATE FUNCTION public.current_operator_profile() RETURNS public.operator_profiles
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select op
  from public.operator_profiles as op
  where op.id = (select auth.uid())
    and op.status = 'active'
  limit 1
$$;

CREATE FUNCTION public.current_operator_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select op.role
  from public.operator_profiles as op
  where op.id = (select auth.uid())
    and op.status = 'active'
  limit 1
$$;

CREATE FUNCTION public.deactivate_element(p_request_id text, p_element_id uuid, p_reason text, p_dropped_on date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

COMMENT ON FUNCTION public.deactivate_element(p_request_id text, p_element_id uuid, p_reason text, p_dropped_on date) IS 'Closes the active enrollment and marks the element inactive without deleting history.';

CREATE FUNCTION public.enforce_created_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if tg_op = 'INSERT' then
    new.created_at = now();
  else
    new.created_at = old.created_at;
  end if;

  return new;
end;
$$;

CREATE FUNCTION public.enforce_self_tutor_consistency() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  full_name text;
begin
  if not new.is_self_tutor then
    return new;
  end if;

  if new.birth_date > ((current_date - interval '18 years')::date) then
    raise exception 'SELF_TUTOR_REQUIRES_ADULT' using errcode = '22023';
  end if;

  full_name := nullif(btrim(concat_ws(
    ' ',
    nullif(btrim(new.given_names), ''),
    nullif(btrim(new.paternal_surname), ''),
    nullif(btrim(new.maternal_surname), '')
  )), '');

  if full_name is null then
    raise exception 'SELF_TUTOR_REQUIRES_NAME' using errcode = '22023';
  end if;

  new.guardian_name := full_name;
  return new;
end;
$$;

CREATE FUNCTION public.find_matching_element(p_given_names text, p_paternal_surname text, p_maternal_surname text, p_birth_date date) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE TABLE public.element_enrollments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    enrollment_code text NOT NULL,
    element_id uuid NOT NULL,
    enrolled_on date NOT NULL,
    billing_start_on date NOT NULL,
    billing_policy text DEFAULT 'first_15_current_else_next'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    dropped_on date,
    drop_reason text,
    created_by uuid,
    dropped_by uuid,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT element_enrollments_billing_policy_check CHECK ((billing_policy = 'first_15_current_else_next'::text)),
    CONSTRAINT element_enrollments_close_check CHECK ((((status = 'active'::text) AND (dropped_on IS NULL) AND (dropped_by IS NULL) AND (drop_reason IS NULL)) OR ((status = ANY (ARRAY['closed'::text, 'cancelled'::text])) AND (dropped_on IS NOT NULL) AND (NULLIF(btrim(drop_reason), ''::text) IS NOT NULL)))),
    CONSTRAINT element_enrollments_code_not_blank CHECK ((btrim(enrollment_code) <> ''::text)),
    CONSTRAINT element_enrollments_dates_check CHECK (((billing_start_on = public.calculate_billing_start_date(enrolled_on, billing_policy)) AND ((dropped_on IS NULL) OR (dropped_on >= enrolled_on)))),
    CONSTRAINT element_enrollments_status_check CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text, 'cancelled'::text])))
);

COMMENT ON TABLE public.element_enrollments IS 'Registration history for each canonical element/person. Re-entry creates a new active row instead of a duplicate element.';

CREATE FUNCTION public.get_active_element_enrollment(p_element_id uuid) RETURNS public.element_enrollments
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select ee
  from public.element_enrollments as ee
  where ee.element_id = p_element_id
    and ee.status = 'active'
  order by ee.enrolled_on desc, ee.created_at desc
  limit 1
$$;

CREATE FUNCTION public.get_dashboard_summary() RETURNS jsonb
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

CREATE FUNCTION public.get_document_compliance_queue() RETURNS jsonb
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

CREATE FUNCTION public.get_element(p_element_id uuid) RETURNS jsonb
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

CREATE FUNCTION public.get_element_attendance_statement(p_element_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  element_row public.elements%rowtype;
  date_from date := coalesce(p_from, date_trunc('month', timezone('America/Mexico_City', now()))::date);
  date_to date := coalesce(p_to, (timezone('America/Mexico_City', now()))::date);
  sessions jsonb;
  records jsonb;
  exceptions jsonb;
  summary jsonb;
begin
  if not public.is_active_operator() then
    raise exception 'ACTIVE_OPERATOR_REQUIRED' using errcode = '42501';
  end if;
  if date_from > date_to or date_to - date_from > 366 then
    raise exception 'INVALID_ATTENDANCE_RANGE' using errcode = '22023';
  end if;

  select * into element_row
  from public.elements
  where id = p_element_id
    and (status = 'active' or public.is_admin_operator());
  if not found then
    raise exception 'ELEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  with applicable as (
    select
      s.id as session_id,
      a.id as activity_id,
      a.name as activity_name,
      a.category,
      s.session_date,
      s.starts_at,
      s.ends_at,
      s.location,
      s.attendance_scope,
      s.attendance_required,
      s.status as session_status,
      ar.id as attendance_id,
      ar.attendance_code,
      ar.status as attendance_status,
      ar.source,
      ar.record_status,
      ar.version,
      ar.occurred_at,
      ar.cancelled_at,
      ar.cancel_reason,
      public.is_element_exempt_from_session(element_row.id, s.id) as is_exempt,
      case
        when ar.id is not null and ar.record_status = 'active' then ar.status
        when a.category = 'mandatory'
          and s.attendance_required
          and s.attendance_scope = 'all_active'
          and public.is_element_exempt_from_session(element_row.id, s.id) then 'exempt'
        when a.category = 'mandatory'
          and s.attendance_required
          and s.attendance_scope = 'all_active'
          and s.session_date <= date_to then 'absent'
        when ar.id is null then 'not_recorded'
        else coalesce(ar.status, 'not_recorded')
      end as calculated_status
    from public.activity_sessions as s
    join public.attendance_activities as a on a.id = s.activity_id
    left join public.attendance_records as ar
      on ar.session_id = s.id
      and ar.element_id = element_row.id
      and ar.record_status = 'active'
    where s.session_date between date_from and date_to
      and s.status <> 'cancelled'
      and (
        (
          a.category = 'mandatory'
          and s.attendance_required
          and s.attendance_scope = 'all_active'
          and s.session_date >= coalesce(element_row.enrolled_on, (element_row.created_at at time zone 'America/Mexico_City')::date)
        )
        or ar.id is not null
        or exists (
          select 1
          from public.element_activity_enrollments as enr
          where enr.element_id = element_row.id
            and enr.activity_id = a.id
            and enr.status = 'enrolled'
            and s.session_date >= enr.starts_on
            and (enr.ends_on is null or s.session_date <= enr.ends_on)
        )
      )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'sessionId', session_id,
    'activityId', activity_id,
    'activityName', activity_name,
    'category', category,
    'sessionDate', session_date,
    'startsAt', starts_at,
    'endsAt', ends_at,
    'location', location,
    'attendanceScope', attendance_scope,
    'attendanceRequired', attendance_required,
    'sessionStatus', session_status,
    'status', calculated_status,
    'isExempt', is_exempt,
    'attendance', case when attendance_id is null then null else jsonb_build_object(
      'attendanceId', attendance_id,
      'attendanceCode', attendance_code,
      'status', attendance_status,
      'source', source,
      'recordStatus', record_status,
      'version', version,
      'occurredAt', occurred_at,
      'cancelledAt', cancelled_at,
      'cancelReason', cancel_reason
    ) end
  ) order by session_date desc, starts_at desc nulls last), '[]'::jsonb)
  into sessions
  from applicable;

  with applicable as (
    select
      a.category,
      s.attendance_required,
      ar.id as attendance_id,
      ar.status as attendance_status,
      public.is_element_exempt_from_session(element_row.id, s.id) as is_exempt,
      case
        when ar.id is not null and ar.record_status = 'active' then ar.status
        when a.category = 'mandatory'
          and s.attendance_required
          and s.attendance_scope = 'all_active'
          and public.is_element_exempt_from_session(element_row.id, s.id) then 'exempt'
        when a.category = 'mandatory'
          and s.attendance_required
          and s.attendance_scope = 'all_active'
          and s.session_date <= date_to then 'absent'
        when ar.id is null then 'not_recorded'
        else coalesce(ar.status, 'not_recorded')
      end as calculated_status
    from public.activity_sessions as s
    join public.attendance_activities as a on a.id = s.activity_id
    left join public.attendance_records as ar
      on ar.session_id = s.id
      and ar.element_id = element_row.id
      and ar.record_status = 'active'
    where s.session_date between date_from and date_to
      and s.status <> 'cancelled'
      and (
        (
          a.category = 'mandatory'
          and s.attendance_required
          and s.attendance_scope = 'all_active'
          and s.session_date >= coalesce(element_row.enrolled_on, (element_row.created_at at time zone 'America/Mexico_City')::date)
        )
        or ar.id is not null
        or exists (
          select 1
          from public.element_activity_enrollments as enr
          where enr.element_id = element_row.id
            and enr.activity_id = a.id
            and enr.status = 'enrolled'
            and s.session_date >= enr.starts_on
            and (enr.ends_on is null or s.session_date <= enr.ends_on)
        )
      )
  )
  select jsonb_build_object(
    'requiredSessions', count(*) filter (where category = 'mandatory' and attendance_required and calculated_status <> 'exempt'),
    'presentCount', count(*) filter (where calculated_status = 'present'),
    'lateCount', count(*) filter (where calculated_status = 'late'),
    'excusedCount', count(*) filter (where calculated_status = 'excused'),
    'absentCount', count(*) filter (where calculated_status = 'absent'),
    'exemptCount', count(*) filter (where calculated_status = 'exempt'),
    'activityRecords', count(*) filter (where category in ('activity', 'event') and attendance_id is not null)
  )
  into summary
  from applicable;

  select coalesce(jsonb_agg(jsonb_build_object(
    'attendanceId', ar.id,
    'attendanceCode', ar.attendance_code,
    'sessionId', ar.session_id,
    'occurredAt', ar.occurred_at,
    'attendanceDate', ar.attendance_date,
    'status', ar.status,
    'source', ar.source,
    'recordStatus', ar.record_status,
    'version', ar.version,
    'cancelledAt', ar.cancelled_at,
    'cancelReason', ar.cancel_reason
  ) order by ar.occurred_at desc), '[]'::jsonb)
  into records
  from public.attendance_records as ar
  where ar.element_id = element_row.id
    and ar.attendance_date between date_from and date_to;

  select coalesce(jsonb_agg(jsonb_build_object(
    'exceptionId', ex.id,
    'scope', ex.scope,
    'weekday', ex.weekday,
    'sessionId', ex.session_id,
    'startsOn', ex.starts_on,
    'endsOn', ex.ends_on,
    'reason', ex.reason,
    'status', ex.status
  ) order by ex.starts_on desc), '[]'::jsonb)
  into exceptions
  from public.element_attendance_exceptions as ex
  where ex.element_id = element_row.id
    and ex.status = 'active'
    and ex.starts_on <= date_to
    and (ex.ends_on is null or ex.ends_on >= date_from);

  return jsonb_build_object(
    'ok', true,
    'elementId', element_row.id,
    'elementName', concat_ws(' ', element_row.given_names, element_row.paternal_surname, element_row.maternal_surname),
    'from', date_from,
    'to', date_to,
    'summary', summary,
    'sessions', sessions,
    'records', records,
    'exceptions', exceptions
  );
end;
$$;

CREATE FUNCTION public.get_element_payment_statement(p_element_id uuid, p_year integer DEFAULT NULL::integer) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

COMMENT ON FUNCTION public.get_element_payment_statement(p_element_id uuid, p_year integer) IS 'Returns the calculated monthly account statement for an element using billing_start_on, payment_fee_schedule and payments.';

CREATE FUNCTION public.get_operational_statistics(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_branch text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_activity text DEFAULT NULL::text) RETURNS jsonb
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

CREATE FUNCTION public.get_operations_digest() RETURNS jsonb
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

CREATE FUNCTION public.is_active_operator() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from public.operator_profiles as op
    where op.id = (select auth.uid())
      and op.status = 'active'
  )
$$;

CREATE FUNCTION public.is_admin_operator() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from public.operator_profiles as op
    where op.id = (select auth.uid())
      and op.status = 'active'
      and op.role = 'admin'
  )
$$;

CREATE FUNCTION public.is_element_exempt_from_session(p_element_id uuid, p_session_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from public.element_attendance_exceptions as ex
    join public.activity_sessions as s on s.id = p_session_id
    where ex.element_id = p_element_id
      and ex.status = 'active'
      and (
        (ex.scope = 'session' and ex.session_id = s.id)
        or (
          ex.scope = 'weekday'
          and ex.weekday = extract(dow from s.session_date)::integer
          and s.session_date >= ex.starts_on
          and (ex.ends_on is null or s.session_date <= ex.ends_on)
        )
        or (
          ex.scope = 'date_range'
          and s.session_date >= ex.starts_on
          and (ex.ends_on is null or s.session_date <= ex.ends_on)
        )
      )
  )
$$;

CREATE FUNCTION public.list_activity_sessions(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_include_inactive boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  date_from date := coalesce(p_from, (now() at time zone 'America/Mexico_City')::date);
  date_to date := coalesce(p_to, coalesce(p_from, (now() at time zone 'America/Mexico_City')::date) + 14);
  items jsonb;
begin
  if not public.is_active_operator() then
    raise exception 'ACTIVE_OPERATOR_REQUIRED' using errcode = '42501';
  end if;
  if date_from > date_to or date_to - date_from > 90 then
    raise exception 'INVALID_ATTENDANCE_RANGE' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'sessionId', s.id,
    'activityId', a.id,
    'activityName', a.name,
    'category', a.category,
    'activityStatus', a.status,
    'sessionDate', s.session_date,
    'startsAt', s.starts_at,
    'endsAt', s.ends_at,
    'location', s.location,
    'attendanceScope', s.attendance_scope,
    'attendanceRequired', s.attendance_required,
    'status', s.status
  ) order by s.session_date, s.starts_at nulls last, a.name), '[]'::jsonb)
  into items
  from public.activity_sessions as s
  join public.attendance_activities as a on a.id = s.activity_id
  where s.session_date between date_from and date_to
    and s.status <> 'cancelled'
    and (p_include_inactive or a.status = 'active');

  return jsonb_build_object('ok', true, 'items', items, 'from', date_from, 'to', date_to);
end;
$$;

CREATE FUNCTION public.list_attendance(p_element_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_limit integer DEFAULT 100) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.list_attendance_activities(p_include_inactive boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  items jsonb;
begin
  if not public.is_active_operator() then
    raise exception 'ACTIVE_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'activityId', a.id,
    'name', a.name,
    'category', a.category,
    'description', a.description,
    'status', a.status
  ) order by a.status, a.category, a.name), '[]'::jsonb)
  into items
  from public.attendance_activities as a
  where p_include_inactive or a.status = 'active';

  return jsonb_build_object('ok', true, 'items', items);
end;
$$;

CREATE FUNCTION public.list_payments(p_element_id uuid, p_year integer DEFAULT NULL::integer, p_limit integer DEFAULT 100) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.normalize_person_match_text(p_value text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select regexp_replace(lower(btrim(coalesce(p_value, ''))), '\s+', ' ', 'g')
$$;

CREATE FUNCTION public.prevent_audit_log_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'audit_log rows are append-only';
end;
$$;

CREATE FUNCTION public.protect_last_active_admin() RETURNS trigger
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

CREATE FUNCTION public.purge_expired_idempotency_keys() RETURNS integer
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

CREATE FUNCTION public.record_attendance(p_request_id text, p_element_id uuid, p_status text DEFAULT 'present'::text, p_source text DEFAULT 'manual'::text, p_session_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  request_hash text;
  replay jsonb;
  new_id uuid := extensions.gen_random_uuid();
  session_row public.activity_sessions%rowtype;
  activity_row public.attendance_activities%rowtype;
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

  if p_session_id is not null then
    select * into session_row
    from public.activity_sessions
    where id = p_session_id;
    if not found then
      raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
    end if;
    if session_row.status not in ('scheduled', 'open') then
      raise exception 'SESSION_NOT_OPEN' using errcode = '55000';
    end if;
    select * into activity_row
    from public.attendance_activities
    where id = session_row.activity_id;
    if activity_row.status <> 'active' then
      raise exception 'ACTIVITY_INACTIVE' using errcode = '55000';
    end if;
  end if;

  request_hash := 'sha256:' || encode(extensions.digest(jsonb_build_object(
    'elementId', p_element_id,
    'sessionId', p_session_id,
    'status', p_status,
    'source', p_source
  )::text, 'sha256'), 'hex');
  replay := public._frontend_claim_request(p_request_id, 'attendance.create', request_hash);
  if replay is not null then return replay; end if;

  begin
    insert into public.attendance_records (
      id, attendance_code, element_id, session_id, occurred_at, attendance_date,
      status, source, record_status, recorded_by
    ) values (
      new_id,
      'ATT-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') || '-' ||
        upper(substr(replace(new_id::text, '-', ''), 1, 8)),
      p_element_id, p_session_id, clock_timestamp(),
      coalesce(session_row.session_date, (now() at time zone 'America/Mexico_City')::date),
      p_status, p_source, 'active', (select auth.uid())
    ) returning * into created;
  exception when unique_violation then
    raise exception 'ATTENDANCE_ALREADY_RECORDED' using errcode = '23505';
  end;

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, after_data, request_id
  ) values (
    (select auth.uid()), 'attendance.recorded', 'attendance', created.id::text,
    jsonb_build_object(
      'elementId', created.element_id, 'sessionId', created.session_id,
      'status', created.status, 'source', created.source,
      'occurredAt', created.occurred_at, 'recordStatus', created.record_status
    ), p_request_id
  );

  response := jsonb_build_object(
    'ok', true,
    'attendance', jsonb_build_object(
      'attendanceId', created.id, 'attendanceCode', created.attendance_code,
      'elementId', created.element_id, 'sessionId', created.session_id,
      'activityName', activity_row.name,
      'sessionDate', created.attendance_date,
      'status', created.status, 'source', created.source,
      'recordStatus', created.record_status,
      'occurredAt', created.occurred_at, 'attendanceDate', created.attendance_date,
      'version', created.version
    )
  );
  perform public._frontend_complete_request(p_request_id, response, 201);
  return response;
end;
$$;

CREATE FUNCTION public.record_payment(p_request_id text, p_element_id uuid, p_year integer, p_month integer, p_method text, p_reference text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

COMMENT ON FUNCTION public.record_payment(p_request_id text, p_element_id uuid, p_year integer, p_month integer, p_method text, p_reference text) IS 'Records a payment using only the authoritative server-side payment_fee_schedule amount.';

CREATE FUNCTION public.register_element_document(p_request_id text, p_element_id uuid, p_document_type text, p_storage_key text, p_original_filename text, p_mime_type text, p_size_bytes bigint) RETURNS jsonb
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

CREATE FUNCTION public.search_elements(p_query text, p_limit integer DEFAULT 20, p_status text DEFAULT 'active'::text) RETURNS jsonb
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

CREATE FUNCTION public.set_activity_session_status(p_session_id uuid, p_status text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  row_data public.activity_sessions%rowtype;
begin
  if not public.is_admin_operator() then
    raise exception 'ADMIN_OPERATOR_REQUIRED' using errcode = '42501';
  end if;
  if p_status not in ('scheduled', 'open', 'closed', 'cancelled') then
    raise exception 'INVALID_SESSION_STATUS' using errcode = '22023';
  end if;

  update public.activity_sessions
  set status = p_status
  where id = p_session_id
  returning * into row_data;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;

  return jsonb_build_object('ok', true, 'sessionId', row_data.id, 'status', row_data.status);
end;
$$;

CREATE FUNCTION public.set_attendance_activity_status(p_activity_id uuid, p_status text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  row_data public.attendance_activities%rowtype;
begin
  if not public.is_admin_operator() then
    raise exception 'ADMIN_OPERATOR_REQUIRED' using errcode = '42501';
  end if;
  if p_status not in ('active', 'inactive') then
    raise exception 'INVALID_ACTIVITY_STATUS' using errcode = '22023';
  end if;

  update public.attendance_activities
  set status = p_status
  where id = p_activity_id
  returning * into row_data;

  if not found then
    raise exception 'ACTIVITY_NOT_FOUND' using errcode = 'P0002';
  end if;

  return jsonb_build_object('ok', true, 'activity', jsonb_build_object(
    'activityId', row_data.id,
    'name', row_data.name,
    'category', row_data.category,
    'description', row_data.description,
    'status', row_data.status
  ));
end;
$$;

CREATE FUNCTION public.set_attendance_date_and_update_metadata() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.set_updated_at_and_increment_version() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.upsert_attendance_activity(p_name text, p_category text DEFAULT 'activity'::text, p_description text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  row_data public.attendance_activities%rowtype;
begin
  if not public.is_admin_operator() then
    raise exception 'ADMIN_OPERATOR_REQUIRED' using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'REQUIRED_ACTIVITY_FIELDS_MISSING' using errcode = '22023';
  end if;
  if p_category not in ('mandatory', 'activity', 'event') then
    raise exception 'INVALID_ACTIVITY_CATEGORY' using errcode = '22023';
  end if;

  insert into public.attendance_activities (name, category, description, status)
  values (btrim(p_name), p_category, nullif(btrim(p_description), ''), 'active')
  on conflict ((lower(btrim(name)))) do update
  set category = excluded.category,
      description = excluded.description,
      status = 'active'
  returning * into row_data;

  return jsonb_build_object('ok', true, 'activity', jsonb_build_object(
    'activityId', row_data.id,
    'name', row_data.name,
    'category', row_data.category,
    'description', row_data.description,
    'status', row_data.status
  ));
end;
$$;

CREATE TABLE public.activity_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    activity_id uuid NOT NULL,
    session_date date NOT NULL,
    starts_at time without time zone,
    ends_at time without time zone,
    location text,
    attendance_scope text DEFAULT 'open'::text NOT NULL,
    attendance_required boolean DEFAULT false NOT NULL,
    status text DEFAULT 'scheduled'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT activity_sessions_scope_check CHECK ((attendance_scope = ANY (ARRAY['all_active'::text, 'enrolled'::text, 'open'::text]))),
    CONSTRAINT activity_sessions_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'open'::text, 'closed'::text, 'cancelled'::text]))),
    CONSTRAINT activity_sessions_time_check CHECK (((ends_at IS NULL) OR (starts_at IS NULL) OR (ends_at > starts_at)))
);

CREATE TABLE public.attendance_activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    category text DEFAULT 'activity'::text NOT NULL,
    description text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT attendance_activities_category_check CHECK ((category = ANY (ARRAY['mandatory'::text, 'activity'::text, 'event'::text]))),
    CONSTRAINT attendance_activities_name_not_blank CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT attendance_activities_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);

CREATE TABLE public.attendance_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    attendance_code text NOT NULL,
    element_id uuid NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    attendance_date date NOT NULL,
    status text NOT NULL,
    source text NOT NULL,
    record_status text DEFAULT 'active'::text NOT NULL,
    recorded_by uuid,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    cancel_reason text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    session_id uuid,
    CONSTRAINT attendance_cancellation_check CHECK ((((record_status = 'active'::text) AND (cancelled_at IS NULL) AND (cancelled_by IS NULL) AND (cancel_reason IS NULL)) OR ((record_status = 'cancelled'::text) AND (cancelled_at IS NOT NULL) AND (NULLIF(btrim(cancel_reason), ''::text) IS NOT NULL)))),
    CONSTRAINT attendance_code_not_blank CHECK ((btrim(attendance_code) <> ''::text)),
    CONSTRAINT attendance_record_status_check CHECK ((record_status = ANY (ARRAY['active'::text, 'cancelled'::text]))),
    CONSTRAINT attendance_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'qr'::text, 'legacy_import'::text]))),
    CONSTRAINT attendance_status_check CHECK ((status = ANY (ARRAY['present'::text, 'absent'::text, 'late'::text, 'excused'::text]))),
    CONSTRAINT attendance_version_positive CHECK ((version >= 1))
);

COMMENT ON TABLE public.attendance_records IS 'Canonical attendance events without duplicated element names.';

CREATE TABLE public.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_user_id uuid,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    before_data jsonb,
    after_data jsonb,
    reason text,
    request_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_log_action_not_blank CHECK ((btrim(action) <> ''::text)),
    CONSTRAINT audit_log_entity_id_not_blank CHECK ((btrim(entity_id) <> ''::text)),
    CONSTRAINT audit_log_entity_type_not_blank CHECK ((btrim(entity_type) <> ''::text))
);

COMMENT ON TABLE public.audit_log IS 'Append-only audit trail. Never store access tokens, OTP values, or file contents.';

CREATE TABLE public.element_activity_enrollments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    element_id uuid NOT NULL,
    activity_id uuid NOT NULL,
    status text DEFAULT 'enrolled'::text NOT NULL,
    starts_on date DEFAULT CURRENT_DATE NOT NULL,
    ends_on date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT element_activity_enrollments_dates_check CHECK (((ends_on IS NULL) OR (ends_on >= starts_on))),
    CONSTRAINT element_activity_enrollments_status_check CHECK ((status = ANY (ARRAY['enrolled'::text, 'dropped'::text])))
);

CREATE TABLE public.element_attendance_exceptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    element_id uuid NOT NULL,
    scope text NOT NULL,
    weekday integer,
    session_id uuid,
    starts_on date DEFAULT CURRENT_DATE NOT NULL,
    ends_on date,
    reason text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT element_attendance_exceptions_dates_check CHECK (((ends_on IS NULL) OR (ends_on >= starts_on))),
    CONSTRAINT element_attendance_exceptions_reason_not_blank CHECK ((btrim(reason) <> ''::text)),
    CONSTRAINT element_attendance_exceptions_scope_check CHECK ((scope = ANY (ARRAY['weekday'::text, 'date_range'::text, 'session'::text]))),
    CONSTRAINT element_attendance_exceptions_scope_fields_check CHECK ((((scope = 'weekday'::text) AND (weekday IS NOT NULL) AND (session_id IS NULL)) OR ((scope = 'session'::text) AND (session_id IS NOT NULL) AND (weekday IS NULL)) OR ((scope = 'date_range'::text) AND (session_id IS NULL)))),
    CONSTRAINT element_attendance_exceptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text]))),
    CONSTRAINT element_attendance_exceptions_weekday_check CHECK (((weekday IS NULL) OR ((weekday >= 0) AND (weekday <= 6))))
);

CREATE TABLE public.element_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    element_id uuid NOT NULL,
    document_type text NOT NULL,
    drive_file_id text,
    drive_url text,
    original_filename text,
    mime_type text,
    size_bytes bigint,
    status text DEFAULT 'active'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    replaces_document_id uuid,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    replaced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT element_documents_replaced_at_check CHECK ((((status = 'replaced'::text) AND (replaced_at IS NOT NULL)) OR ((status <> 'replaced'::text) AND (replaced_at IS NULL)))),
    CONSTRAINT element_documents_size_nonnegative CHECK (((size_bytes IS NULL) OR (size_bytes >= 0))),
    CONSTRAINT element_documents_status_check CHECK ((status = ANY (ARRAY['active'::text, 'replaced'::text, 'cancelled'::text]))),
    CONSTRAINT element_documents_type_not_blank CHECK ((btrim(document_type) <> ''::text)),
    CONSTRAINT element_documents_version_positive CHECK ((version >= 1))
);

COMMENT ON TABLE public.element_documents IS 'Document metadata and replacement history. File bytes remain in controlled storage.';

CREATE TABLE public.elements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    element_code text NOT NULL,
    given_names text NOT NULL,
    paternal_surname text NOT NULL,
    maternal_surname text,
    birth_date date NOT NULL,
    sex_code text NOT NULL,
    group_code text,
    medical_notes text,
    guardian_name text NOT NULL,
    guardian_phone text NOT NULL,
    qr_value text,
    drive_folder_id text,
    drive_folder_url text,
    status text DEFAULT 'active'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    enrolled_on date NOT NULL,
    billing_start_on date NOT NULL,
    billing_policy text DEFAULT 'first_15_current_else_next'::text NOT NULL,
    is_self_tutor boolean DEFAULT false NOT NULL,
    CONSTRAINT elements_billing_dates_check CHECK ((billing_start_on = public.calculate_billing_start_date(enrolled_on, billing_policy))),
    CONSTRAINT elements_billing_policy_check CHECK ((billing_policy = 'first_15_current_else_next'::text)),
    CONSTRAINT elements_code_not_blank CHECK ((btrim(element_code) <> ''::text)),
    CONSTRAINT elements_given_names_not_blank CHECK ((btrim(given_names) <> ''::text)),
    CONSTRAINT elements_guardian_name_not_blank CHECK ((btrim(guardian_name) <> ''::text)),
    CONSTRAINT elements_guardian_phone_not_blank CHECK ((btrim(guardian_phone) <> ''::text)),
    CONSTRAINT elements_paternal_surname_not_blank CHECK ((btrim(paternal_surname) <> ''::text)),
    CONSTRAINT elements_sex_code_not_blank CHECK ((btrim(sex_code) <> ''::text)),
    CONSTRAINT elements_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'archived'::text]))),
    CONSTRAINT elements_version_positive CHECK ((version >= 1))
);

COMMENT ON TABLE public.elements IS 'Canonical element registry. element_code preserves the legacy business ID.';

CREATE TABLE public.idempotency_keys (
    key text NOT NULL,
    actor_user_id uuid,
    action text NOT NULL,
    request_hash text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    response_status integer,
    response jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT idempotency_action_not_blank CHECK ((btrim(action) <> ''::text)),
    CONSTRAINT idempotency_expiration_check CHECK ((expires_at > created_at)),
    CONSTRAINT idempotency_key_not_blank CHECK ((btrim(key) <> ''::text)),
    CONSTRAINT idempotency_request_hash_not_blank CHECK ((btrim(request_hash) <> ''::text)),
    CONSTRAINT idempotency_response_status_check CHECK (((response_status IS NULL) OR ((response_status >= 100) AND (response_status <= 599)))),
    CONSTRAINT idempotency_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text])))
);

COMMENT ON TABLE public.idempotency_keys IS 'Server-side idempotency registry. Cached responses must not contain tokens or unnecessary PII.';

CREATE TABLE public.payment_fee_schedule (
    year integer NOT NULL,
    month integer NOT NULL,
    amount_cents integer NOT NULL,
    currency text DEFAULT 'MXN'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_fee_schedule_amount_positive CHECK ((amount_cents > 0)),
    CONSTRAINT payment_fee_schedule_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT payment_fee_schedule_month_check CHECK (((month >= 1) AND (month <= 12))),
    CONSTRAINT payment_fee_schedule_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text]))),
    CONSTRAINT payment_fee_schedule_year_check CHECK (((year >= 2000) AND (year <= 2100)))
);

COMMENT ON TABLE public.payment_fee_schedule IS 'Authoritative monthly payment amounts used by record_payment; never supplied by the browser.';

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_code text NOT NULL,
    element_id uuid NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    amount_cents integer NOT NULL,
    currency text DEFAULT 'MXN'::text NOT NULL,
    method text NOT NULL,
    reference text,
    status text DEFAULT 'posted'::text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    recorded_by uuid,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    cancel_reason text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    enrollment_id uuid,
    CONSTRAINT payments_amount_positive CHECK ((amount_cents > 0)),
    CONSTRAINT payments_cancellation_check CHECK ((((status = 'posted'::text) AND (cancelled_at IS NULL) AND (cancelled_by IS NULL) AND (cancel_reason IS NULL)) OR ((status = 'cancelled'::text) AND (cancelled_at IS NOT NULL) AND (NULLIF(btrim(cancel_reason), ''::text) IS NOT NULL)))),
    CONSTRAINT payments_code_not_blank CHECK ((btrim(payment_code) <> ''::text)),
    CONSTRAINT payments_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT payments_method_not_blank CHECK ((btrim(method) <> ''::text)),
    CONSTRAINT payments_month_check CHECK (((month >= 1) AND (month <= 12))),
    CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['posted'::text, 'cancelled'::text]))),
    CONSTRAINT payments_version_positive CHECK ((version >= 1)),
    CONSTRAINT payments_year_check CHECK (((year >= 2000) AND (year <= 2100)))
);

COMMENT ON TABLE public.payments IS 'One row per element and monthly period. Active duplicates are prevented by a partial unique index.';

ALTER TABLE ONLY public.activity_sessions
    ADD CONSTRAINT activity_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.attendance_activities
    ADD CONSTRAINT attendance_activities_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.element_activity_enrollments
    ADD CONSTRAINT element_activity_enrollments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.element_attendance_exceptions
    ADD CONSTRAINT element_attendance_exceptions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.element_documents
    ADD CONSTRAINT element_documents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.element_enrollments
    ADD CONSTRAINT element_enrollments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.elements
    ADD CONSTRAINT elements_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (key);

ALTER TABLE ONLY public.operator_profiles
    ADD CONSTRAINT operator_profiles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payment_fee_schedule
    ADD CONSTRAINT payment_fee_schedule_pkey PRIMARY KEY (year, month);

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX activity_sessions_active_activity_day_uidx ON public.activity_sessions USING btree (activity_id, session_date) WHERE (status <> 'cancelled'::text);

CREATE INDEX activity_sessions_activity_idx ON public.activity_sessions USING btree (activity_id, session_date);

CREATE INDEX activity_sessions_calendar_idx ON public.activity_sessions USING btree (session_date, status);

CREATE UNIQUE INDEX attendance_activities_name_lower_uidx ON public.attendance_activities USING btree (lower(btrim(name)));

CREATE INDEX attendance_activities_status_idx ON public.attendance_activities USING btree (status, category);

CREATE UNIQUE INDEX attendance_code_lower_uidx ON public.attendance_records USING btree (lower(btrim(attendance_code)));

CREATE INDEX attendance_date_status_idx ON public.attendance_records USING btree (attendance_date, status);

CREATE INDEX attendance_element_occurred_idx ON public.attendance_records USING btree (element_id, occurred_at DESC);

CREATE INDEX attendance_record_status_idx ON public.attendance_records USING btree (record_status);

CREATE UNIQUE INDEX attendance_records_active_session_element_uidx ON public.attendance_records USING btree (session_id, element_id) WHERE ((session_id IS NOT NULL) AND (record_status = 'active'::text));

CREATE INDEX attendance_records_session_idx ON public.attendance_records USING btree (session_id, record_status);

CREATE INDEX audit_log_actor_idx ON public.audit_log USING btree (actor_user_id, created_at DESC);

CREATE INDEX audit_log_created_at_idx ON public.audit_log USING btree (created_at DESC);

CREATE INDEX audit_log_entity_idx ON public.audit_log USING btree (entity_type, entity_id, created_at DESC);

CREATE INDEX audit_log_request_id_idx ON public.audit_log USING btree (request_id) WHERE (request_id IS NOT NULL);

CREATE UNIQUE INDEX element_activity_enrollments_active_uidx ON public.element_activity_enrollments USING btree (element_id, activity_id) WHERE (status = 'enrolled'::text);

CREATE INDEX element_activity_enrollments_activity_idx ON public.element_activity_enrollments USING btree (activity_id, status);

CREATE INDEX element_attendance_exceptions_element_idx ON public.element_attendance_exceptions USING btree (element_id, status, starts_on, ends_on);

CREATE INDEX element_attendance_exceptions_session_idx ON public.element_attendance_exceptions USING btree (session_id, status);

CREATE UNIQUE INDEX element_documents_active_type_uidx ON public.element_documents USING btree (element_id, document_type) WHERE (status = 'active'::text);

CREATE UNIQUE INDEX element_documents_drive_file_id_uidx ON public.element_documents USING btree (drive_file_id) WHERE (drive_file_id IS NOT NULL);

CREATE INDEX element_documents_element_id_idx ON public.element_documents USING btree (element_id);

CREATE INDEX element_documents_element_type_idx ON public.element_documents USING btree (element_id, document_type);

CREATE UNIQUE INDEX element_enrollments_active_element_uidx ON public.element_enrollments USING btree (element_id) WHERE (status = 'active'::text);

CREATE INDEX element_enrollments_billing_idx ON public.element_enrollments USING btree (status, billing_start_on);

CREATE UNIQUE INDEX element_enrollments_code_lower_uidx ON public.element_enrollments USING btree (lower(btrim(enrollment_code)));

CREATE INDEX element_enrollments_element_status_idx ON public.element_enrollments USING btree (element_id, status, enrolled_on DESC);

CREATE INDEX elements_billing_status_idx ON public.elements USING btree (status, billing_start_on);

CREATE UNIQUE INDEX elements_drive_folder_id_uidx ON public.elements USING btree (drive_folder_id) WHERE (drive_folder_id IS NOT NULL);

CREATE UNIQUE INDEX elements_element_code_lower_uidx ON public.elements USING btree (lower(btrim(element_code)));

CREATE INDEX elements_given_names_trgm_idx ON public.elements USING gin (given_names extensions.gin_trgm_ops);

CREATE INDEX elements_group_status_idx ON public.elements USING btree (group_code, status);

CREATE INDEX elements_maternal_surname_trgm_idx ON public.elements USING gin (maternal_surname extensions.gin_trgm_ops);

CREATE INDEX elements_paternal_surname_trgm_idx ON public.elements USING gin (paternal_surname extensions.gin_trgm_ops);

CREATE UNIQUE INDEX elements_qr_value_uidx ON public.elements USING btree (qr_value) WHERE (qr_value IS NOT NULL);

CREATE INDEX elements_status_idx ON public.elements USING btree (status);

CREATE INDEX idempotency_keys_action_created_idx ON public.idempotency_keys USING btree (action, created_at DESC);

CREATE INDEX idempotency_keys_expires_at_idx ON public.idempotency_keys USING btree (expires_at);

CREATE UNIQUE INDEX operator_profiles_email_lower_uidx ON public.operator_profiles USING btree (lower(btrim(email)));

CREATE INDEX operator_profiles_role_status_idx ON public.operator_profiles USING btree (role, status);

CREATE UNIQUE INDEX payments_active_enrollment_period_uidx ON public.payments USING btree (enrollment_id, year, month) WHERE ((status = 'posted'::text) AND (enrollment_id IS NOT NULL));

CREATE INDEX payments_element_year_idx ON public.payments USING btree (element_id, year, month);

CREATE INDEX payments_enrollment_year_idx ON public.payments USING btree (enrollment_id, year, month);

CREATE UNIQUE INDEX payments_payment_code_lower_uidx ON public.payments USING btree (lower(btrim(payment_code)));

CREATE INDEX payments_recorded_at_idx ON public.payments USING btree (recorded_at DESC);

CREATE INDEX payments_status_idx ON public.payments USING btree (status);

CREATE TRIGGER activity_sessions_set_updated_at BEFORE INSERT OR UPDATE ON public.activity_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER attendance_activities_set_updated_at BEFORE INSERT OR UPDATE ON public.attendance_activities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER attendance_records_set_metadata BEFORE INSERT OR UPDATE ON public.attendance_records FOR EACH ROW EXECUTE FUNCTION public.set_attendance_date_and_update_metadata();

CREATE TRIGGER audit_log_append_only BEFORE DELETE OR UPDATE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_mutation();

CREATE TRIGGER audit_log_enforce_created_at BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.enforce_created_at();

CREATE TRIGGER element_activity_enrollments_set_updated_at BEFORE INSERT OR UPDATE ON public.element_activity_enrollments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER element_attendance_exceptions_set_updated_at BEFORE INSERT OR UPDATE ON public.element_attendance_exceptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER element_documents_audit_change AFTER INSERT OR UPDATE ON public.element_documents FOR EACH ROW EXECUTE FUNCTION public.audit_element_document_change();

CREATE TRIGGER element_documents_enforce_created_at BEFORE INSERT OR UPDATE ON public.element_documents FOR EACH ROW EXECUTE FUNCTION public.enforce_created_at();

CREATE TRIGGER element_enrollments_set_updated_at BEFORE INSERT OR UPDATE ON public.element_enrollments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_and_increment_version();

CREATE TRIGGER elements_audit_profile_update AFTER UPDATE ON public.elements FOR EACH ROW EXECUTE FUNCTION public.audit_element_profile_update();

CREATE TRIGGER elements_enforce_self_tutor_consistency BEFORE INSERT OR UPDATE OF given_names, paternal_surname, maternal_surname, birth_date, guardian_name, is_self_tutor ON public.elements FOR EACH ROW EXECUTE FUNCTION public.enforce_self_tutor_consistency();

CREATE TRIGGER elements_set_updated_at BEFORE INSERT OR UPDATE ON public.elements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_and_increment_version();

CREATE TRIGGER idempotency_keys_enforce_created_at BEFORE INSERT OR UPDATE ON public.idempotency_keys FOR EACH ROW EXECUTE FUNCTION public.enforce_created_at();

CREATE TRIGGER operator_profiles_protect_last_admin BEFORE UPDATE OF role, status ON public.operator_profiles FOR EACH ROW EXECUTE FUNCTION public.protect_last_active_admin();

CREATE TRIGGER operator_profiles_set_updated_at BEFORE INSERT OR UPDATE ON public.operator_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER payment_fee_schedule_set_updated_at BEFORE INSERT OR UPDATE ON public.payment_fee_schedule FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER payments_set_updated_at BEFORE INSERT OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_and_increment_version();

ALTER TABLE ONLY public.activity_sessions
    ADD CONSTRAINT activity_sessions_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.attendance_activities(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.operator_profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_element_id_fkey FOREIGN KEY (element_id) REFERENCES public.elements(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.operator_profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.activity_sessions(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.element_activity_enrollments
    ADD CONSTRAINT element_activity_enrollments_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.attendance_activities(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.element_activity_enrollments
    ADD CONSTRAINT element_activity_enrollments_element_id_fkey FOREIGN KEY (element_id) REFERENCES public.elements(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.element_attendance_exceptions
    ADD CONSTRAINT element_attendance_exceptions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.operator_profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.element_attendance_exceptions
    ADD CONSTRAINT element_attendance_exceptions_element_id_fkey FOREIGN KEY (element_id) REFERENCES public.elements(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.element_attendance_exceptions
    ADD CONSTRAINT element_attendance_exceptions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.activity_sessions(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.element_documents
    ADD CONSTRAINT element_documents_element_id_fkey FOREIGN KEY (element_id) REFERENCES public.elements(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.element_documents
    ADD CONSTRAINT element_documents_replaces_document_id_fkey FOREIGN KEY (replaces_document_id) REFERENCES public.element_documents(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.element_enrollments
    ADD CONSTRAINT element_enrollments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.operator_profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.element_enrollments
    ADD CONSTRAINT element_enrollments_dropped_by_fkey FOREIGN KEY (dropped_by) REFERENCES public.operator_profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.element_enrollments
    ADD CONSTRAINT element_enrollments_element_id_fkey FOREIGN KEY (element_id) REFERENCES public.elements(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.operator_profiles
    ADD CONSTRAINT operator_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.operator_profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_element_id_fkey FOREIGN KEY (element_id) REFERENCES public.elements(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.element_enrollments(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.operator_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.activity_sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.attendance_activities ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY attendance_select_active_operator ON public.attendance_records FOR SELECT TO authenticated USING (( SELECT public.is_active_operator() AS is_active_operator));

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_select_admin ON public.audit_log FOR SELECT TO authenticated USING (( SELECT public.is_admin_operator() AS is_admin_operator));

ALTER TABLE public.element_activity_enrollments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.element_attendance_exceptions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.element_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY element_documents_insert_admin ON public.element_documents FOR INSERT TO authenticated WITH CHECK ((( SELECT public.is_admin_operator() AS is_admin_operator) AND (EXISTS ( SELECT 1
   FROM public.elements e
  WHERE (e.id = element_documents.element_id)))));

CREATE POLICY element_documents_select_visible ON public.element_documents FOR SELECT TO authenticated USING ((( SELECT public.is_admin_operator() AS is_admin_operator) OR ((status = 'active'::text) AND ( SELECT public.is_active_operator() AS is_active_operator) AND (EXISTS ( SELECT 1
   FROM public.elements e
  WHERE ((e.id = element_documents.element_id) AND (e.status = 'active'::text)))))));

CREATE POLICY element_documents_update_admin ON public.element_documents FOR UPDATE TO authenticated USING (( SELECT public.is_admin_operator() AS is_admin_operator)) WITH CHECK (( SELECT public.is_admin_operator() AS is_admin_operator));

ALTER TABLE public.element_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY element_enrollments_insert_admin ON public.element_enrollments FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_admin_operator() AS is_admin_operator));

CREATE POLICY element_enrollments_select_visible ON public.element_enrollments FOR SELECT TO authenticated USING ((( SELECT public.is_admin_operator() AS is_admin_operator) OR (( SELECT public.is_active_operator() AS is_active_operator) AND (EXISTS ( SELECT 1
   FROM public.elements e
  WHERE ((e.id = element_enrollments.element_id) AND (e.status = 'active'::text)))))));

CREATE POLICY element_enrollments_update_admin ON public.element_enrollments FOR UPDATE TO authenticated USING (( SELECT public.is_admin_operator() AS is_admin_operator)) WITH CHECK (( SELECT public.is_admin_operator() AS is_admin_operator));

ALTER TABLE public.elements ENABLE ROW LEVEL SECURITY;

CREATE POLICY elements_insert_admin ON public.elements FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_admin_operator() AS is_admin_operator));

CREATE POLICY elements_select_visible ON public.elements FOR SELECT TO authenticated USING ((((status = 'active'::text) AND ( SELECT public.is_active_operator() AS is_active_operator)) OR ( SELECT public.is_admin_operator() AS is_admin_operator)));

CREATE POLICY elements_update_admin ON public.elements FOR UPDATE TO authenticated USING (( SELECT public.is_admin_operator() AS is_admin_operator)) WITH CHECK (( SELECT public.is_admin_operator() AS is_admin_operator));

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.operator_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY operator_profiles_select_self_or_admin ON public.operator_profiles FOR SELECT TO authenticated USING ((((id = ( SELECT auth.uid() AS uid)) AND (status = 'active'::text)) OR ( SELECT public.is_admin_operator() AS is_admin_operator)));

ALTER TABLE public.payment_fee_schedule ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY payments_select_active_operator ON public.payments FOR SELECT TO authenticated USING (( SELECT public.is_active_operator() AS is_active_operator));

REVOKE ALL ON FUNCTION public._frontend_claim_request(p_request_id text, p_action text, p_request_hash text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public._frontend_complete_request(p_request_id text, p_response jsonb, p_response_status integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.calculate_element_group(p_birth_date date, p_sex_code text, p_reference_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.calculate_element_group(p_birth_date date, p_sex_code text, p_reference_date date) TO authenticated;
GRANT ALL ON FUNCTION public.calculate_element_group(p_birth_date date, p_sex_code text, p_reference_date date) TO service_role;

REVOKE ALL ON FUNCTION public.cancel_attendance(p_request_id text, p_attendance_id uuid, p_expected_version integer, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_attendance(p_request_id text, p_attendance_id uuid, p_expected_version integer, p_reason text) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_payment(p_request_id text, p_payment_id uuid, p_expected_version integer, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_payment(p_request_id text, p_payment_id uuid, p_expected_version integer, p_reason text) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_element_assets(p_request_id text, p_element_id uuid, p_drive_folder_id text, p_drive_folder_url text, p_qr_value text, p_documents jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_element_assets(p_request_id text, p_element_id uuid, p_drive_folder_id text, p_drive_folder_url text, p_qr_value text, p_documents jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.complete_element_assets(p_request_id text, p_element_id uuid, p_drive_folder_id text, p_drive_folder_url text, p_qr_value text, p_documents jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.create_activity_session(p_activity_id uuid, p_session_date date, p_starts_at time without time zone, p_ends_at time without time zone, p_location text, p_attendance_scope text, p_attendance_required boolean, p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_activity_session(p_activity_id uuid, p_session_date date, p_starts_at time without time zone, p_ends_at time without time zone, p_location text, p_attendance_scope text, p_attendance_required boolean, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.create_activity_session(p_activity_id uuid, p_session_date date, p_starts_at time without time zone, p_ends_at time without time zone, p_location text, p_attendance_scope text, p_attendance_required boolean, p_status text) TO service_role;

REVOKE ALL ON FUNCTION public.create_attendance_exception(p_element_id uuid, p_scope text, p_reason text, p_weekday integer, p_session_id uuid, p_starts_on date, p_ends_on date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_attendance_exception(p_element_id uuid, p_scope text, p_reason text, p_weekday integer, p_session_id uuid, p_starts_on date, p_ends_on date) TO authenticated;
GRANT ALL ON FUNCTION public.create_attendance_exception(p_element_id uuid, p_scope text, p_reason text, p_weekday integer, p_session_id uuid, p_starts_on date, p_ends_on date) TO service_role;

REVOKE ALL ON FUNCTION public.create_element(p_request_id text, p_given_names text, p_paternal_surname text, p_birth_date date, p_sex_code text, p_guardian_name text, p_guardian_phone text, p_maternal_surname text, p_group_code text, p_medical_notes text, p_enrolled_on date, p_billing_policy text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_element(p_request_id text, p_given_names text, p_paternal_surname text, p_birth_date date, p_sex_code text, p_guardian_name text, p_guardian_phone text, p_maternal_surname text, p_group_code text, p_medical_notes text, p_enrolled_on date, p_billing_policy text) TO authenticated;
GRANT ALL ON FUNCTION public.create_element(p_request_id text, p_given_names text, p_paternal_surname text, p_birth_date date, p_sex_code text, p_guardian_name text, p_guardian_phone text, p_maternal_surname text, p_group_code text, p_medical_notes text, p_enrolled_on date, p_billing_policy text) TO service_role;

GRANT SELECT,INSERT,UPDATE ON TABLE public.operator_profiles TO service_role;
GRANT SELECT ON TABLE public.operator_profiles TO authenticated;

REVOKE ALL ON FUNCTION public.current_operator_profile() FROM PUBLIC;
GRANT ALL ON FUNCTION public.current_operator_profile() TO authenticated;

REVOKE ALL ON FUNCTION public.current_operator_role() FROM PUBLIC;
GRANT ALL ON FUNCTION public.current_operator_role() TO authenticated;

REVOKE ALL ON FUNCTION public.deactivate_element(p_request_id text, p_element_id uuid, p_reason text, p_dropped_on date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.deactivate_element(p_request_id text, p_element_id uuid, p_reason text, p_dropped_on date) TO authenticated;
GRANT ALL ON FUNCTION public.deactivate_element(p_request_id text, p_element_id uuid, p_reason text, p_dropped_on date) TO service_role;

GRANT SELECT,INSERT,UPDATE ON TABLE public.element_enrollments TO authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.element_enrollments TO service_role;

REVOKE ALL ON FUNCTION public.get_dashboard_summary() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_dashboard_summary() TO authenticated;
GRANT ALL ON FUNCTION public.get_dashboard_summary() TO service_role;

REVOKE ALL ON FUNCTION public.get_document_compliance_queue() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_document_compliance_queue() TO authenticated;
GRANT ALL ON FUNCTION public.get_document_compliance_queue() TO service_role;

REVOKE ALL ON FUNCTION public.get_element(p_element_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_element(p_element_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_element(p_element_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.get_element_attendance_statement(p_element_id uuid, p_from date, p_to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_element_attendance_statement(p_element_id uuid, p_from date, p_to date) TO authenticated;
GRANT ALL ON FUNCTION public.get_element_attendance_statement(p_element_id uuid, p_from date, p_to date) TO service_role;

REVOKE ALL ON FUNCTION public.get_element_payment_statement(p_element_id uuid, p_year integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_element_payment_statement(p_element_id uuid, p_year integer) TO authenticated;
GRANT ALL ON FUNCTION public.get_element_payment_statement(p_element_id uuid, p_year integer) TO service_role;

REVOKE ALL ON FUNCTION public.get_operational_statistics(p_from date, p_to date, p_branch text, p_category text, p_activity text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_operational_statistics(p_from date, p_to date, p_branch text, p_category text, p_activity text) TO authenticated;
GRANT ALL ON FUNCTION public.get_operational_statistics(p_from date, p_to date, p_branch text, p_category text, p_activity text) TO service_role;

REVOKE ALL ON FUNCTION public.get_operations_digest() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_operations_digest() TO authenticated;
GRANT ALL ON FUNCTION public.get_operations_digest() TO service_role;

REVOKE ALL ON FUNCTION public.is_active_operator() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_active_operator() TO authenticated;

REVOKE ALL ON FUNCTION public.is_admin_operator() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_admin_operator() TO authenticated;

REVOKE ALL ON FUNCTION public.list_activity_sessions(p_from date, p_to date, p_include_inactive boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_activity_sessions(p_from date, p_to date, p_include_inactive boolean) TO authenticated;
GRANT ALL ON FUNCTION public.list_activity_sessions(p_from date, p_to date, p_include_inactive boolean) TO service_role;

REVOKE ALL ON FUNCTION public.list_attendance(p_element_id uuid, p_from date, p_to date, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_attendance(p_element_id uuid, p_from date, p_to date, p_limit integer) TO authenticated;

REVOKE ALL ON FUNCTION public.list_attendance_activities(p_include_inactive boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_attendance_activities(p_include_inactive boolean) TO authenticated;
GRANT ALL ON FUNCTION public.list_attendance_activities(p_include_inactive boolean) TO service_role;

REVOKE ALL ON FUNCTION public.list_payments(p_element_id uuid, p_year integer, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_payments(p_element_id uuid, p_year integer, p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.list_payments(p_element_id uuid, p_year integer, p_limit integer) TO service_role;

REVOKE ALL ON FUNCTION public.purge_expired_idempotency_keys() FROM PUBLIC;
GRANT ALL ON FUNCTION public.purge_expired_idempotency_keys() TO service_role;

REVOKE ALL ON FUNCTION public.record_attendance(p_request_id text, p_element_id uuid, p_status text, p_source text, p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_attendance(p_request_id text, p_element_id uuid, p_status text, p_source text, p_session_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.record_attendance(p_request_id text, p_element_id uuid, p_status text, p_source text, p_session_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.record_payment(p_request_id text, p_element_id uuid, p_year integer, p_month integer, p_method text, p_reference text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_payment(p_request_id text, p_element_id uuid, p_year integer, p_month integer, p_method text, p_reference text) TO authenticated;
GRANT ALL ON FUNCTION public.record_payment(p_request_id text, p_element_id uuid, p_year integer, p_month integer, p_method text, p_reference text) TO service_role;

REVOKE ALL ON FUNCTION public.register_element_document(p_request_id text, p_element_id uuid, p_document_type text, p_storage_key text, p_original_filename text, p_mime_type text, p_size_bytes bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.register_element_document(p_request_id text, p_element_id uuid, p_document_type text, p_storage_key text, p_original_filename text, p_mime_type text, p_size_bytes bigint) TO authenticated;
GRANT ALL ON FUNCTION public.register_element_document(p_request_id text, p_element_id uuid, p_document_type text, p_storage_key text, p_original_filename text, p_mime_type text, p_size_bytes bigint) TO service_role;

REVOKE ALL ON FUNCTION public.search_elements(p_query text, p_limit integer, p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.search_elements(p_query text, p_limit integer, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.search_elements(p_query text, p_limit integer, p_status text) TO service_role;

REVOKE ALL ON FUNCTION public.set_activity_session_status(p_session_id uuid, p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_activity_session_status(p_session_id uuid, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.set_activity_session_status(p_session_id uuid, p_status text) TO service_role;

REVOKE ALL ON FUNCTION public.set_attendance_activity_status(p_activity_id uuid, p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_attendance_activity_status(p_activity_id uuid, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.set_attendance_activity_status(p_activity_id uuid, p_status text) TO service_role;

REVOKE ALL ON FUNCTION public.upsert_attendance_activity(p_name text, p_category text, p_description text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.upsert_attendance_activity(p_name text, p_category text, p_description text) TO authenticated;
GRANT ALL ON FUNCTION public.upsert_attendance_activity(p_name text, p_category text, p_description text) TO service_role;

GRANT SELECT,INSERT,UPDATE ON TABLE public.activity_sessions TO service_role;

GRANT SELECT,INSERT,UPDATE ON TABLE public.attendance_activities TO service_role;

GRANT SELECT,INSERT,UPDATE ON TABLE public.attendance_records TO service_role;
GRANT SELECT ON TABLE public.attendance_records TO authenticated;

GRANT SELECT,INSERT ON TABLE public.audit_log TO service_role;
GRANT SELECT ON TABLE public.audit_log TO authenticated;

GRANT SELECT,INSERT,UPDATE ON TABLE public.element_activity_enrollments TO service_role;

GRANT SELECT,INSERT,UPDATE ON TABLE public.element_attendance_exceptions TO service_role;

GRANT SELECT,INSERT,UPDATE ON TABLE public.element_documents TO service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.element_documents TO authenticated;

GRANT SELECT,INSERT,UPDATE ON TABLE public.elements TO service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.elements TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.idempotency_keys TO service_role;

GRANT SELECT,INSERT,UPDATE ON TABLE public.payment_fee_schedule TO service_role;

GRANT SELECT,INSERT,UPDATE ON TABLE public.payments TO service_role;
GRANT SELECT ON TABLE public.payments TO authenticated;

create trigger auth_user_bootstrap_operator_profile
after insert on auth.users
for each row execute function public.bootstrap_operator_profile();

insert into public.attendance_activities (name, category, description, status)
values (
  'Entrenamiento obligatorio',
  'mandatory',
  'Sesiones obligatorias de miércoles, sábado y domingo.',
  'active'
)
on conflict ((lower(btrim(name)))) do update
set category = excluded.category,
    description = excluded.description,
    status = public.attendance_activities.status;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'element-documents',
  'element-documents',
  false,
  10485760,
  array['application/pdf']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy element_documents_storage_select_admin
on storage.objects
for select
to authenticated
using (
  bucket_id = 'element-documents'
  and (select public.is_admin_operator())
);

create policy element_documents_storage_insert_admin
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'element-documents'
  and (select public.is_admin_operator())
);

create policy element_documents_storage_update_admin
on storage.objects
for update
to authenticated
using (
  bucket_id = 'element-documents'
  and (select public.is_admin_operator())
)
with check (
  bucket_id = 'element-documents'
  and (select public.is_admin_operator())
);

create policy element_documents_storage_delete_admin
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'element-documents'
  and (select public.is_admin_operator())
);

commit;

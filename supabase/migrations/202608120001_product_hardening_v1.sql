begin;

alter table public.elements
add column if not exists is_self_tutor boolean not null default false;

create or replace function public.bootstrap_operator_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

drop trigger if exists auth_user_bootstrap_operator_profile on auth.users;
create trigger auth_user_bootstrap_operator_profile
after insert on auth.users
for each row execute function public.bootstrap_operator_profile();

create or replace function public.protect_last_active_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
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

drop trigger if exists operator_profiles_protect_last_admin on public.operator_profiles;
create trigger operator_profiles_protect_last_admin
before update of role, status on public.operator_profiles
for each row execute function public.protect_last_active_admin();

create or replace function public.enforce_self_tutor_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
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

drop trigger if exists elements_enforce_self_tutor_consistency on public.elements;
create trigger elements_enforce_self_tutor_consistency
before insert or update of
  given_names,
  paternal_surname,
  maternal_surname,
  birth_date,
  guardian_name,
  is_self_tutor
on public.elements
for each row execute function public.enforce_self_tutor_consistency();

create or replace function public.audit_element_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

drop trigger if exists elements_audit_profile_update on public.elements;
create trigger elements_audit_profile_update
after update on public.elements
for each row execute function public.audit_element_profile_update();

create or replace function public.audit_element_document_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

drop trigger if exists element_documents_audit_change on public.element_documents;
create trigger element_documents_audit_change
after insert or update on public.element_documents
for each row execute function public.audit_element_document_change();

create or replace function public.register_element_document(
  p_request_id text,
  p_element_id uuid,
  p_document_type text,
  p_storage_key text,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function public.get_operations_digest()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function public.get_document_compliance_queue()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function public.purge_expired_idempotency_keys()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.get_operations_digest() from public, anon;
grant execute on function public.get_operations_digest() to authenticated, service_role;

revoke all on function public.get_document_compliance_queue() from public, anon;
grant execute on function public.get_document_compliance_queue() to authenticated, service_role;

revoke all on function public.register_element_document(
  text, uuid, text, text, text, text, bigint
) from public, anon;
grant execute on function public.register_element_document(
  text, uuid, text, text, text, text, bigint
) to authenticated, service_role;

revoke all on function public.purge_expired_idempotency_keys() from public, anon, authenticated;
grant execute on function public.purge_expired_idempotency_keys() to service_role;

commit;

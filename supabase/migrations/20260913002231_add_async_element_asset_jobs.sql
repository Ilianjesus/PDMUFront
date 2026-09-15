begin;

create table if not exists public.element_asset_jobs (
  request_id text primary key,
  element_id uuid not null references public.elements(id) on delete cascade,
  requested_by uuid not null references public.operator_profiles(id) on delete restrict,
  status text not null default 'queued',
  documents jsonb not null default '[]'::jsonb,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_expires_at timestamptz,
  last_error_code text,
  last_error_message text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint element_asset_jobs_request_id_not_blank
    check (btrim(request_id) <> ''),
  constraint element_asset_jobs_status_check
    check (status in ('queued', 'processing', 'completed', 'failed')),
  constraint element_asset_jobs_documents_array_check
    check (jsonb_typeof(documents) = 'array'),
  constraint element_asset_jobs_attempts_nonnegative
    check (attempts >= 0),
  constraint element_asset_jobs_completion_check
    check (
      (status = 'completed' and completed_at is not null)
      or (status <> 'completed' and completed_at is null)
    )
);

comment on table public.element_asset_jobs is
  'Durable queue for asynchronous QR, PDF and Drive provisioning.';

create index if not exists element_asset_jobs_element_created_idx
  on public.element_asset_jobs (element_id, created_at desc);

create index if not exists element_asset_jobs_claim_idx
  on public.element_asset_jobs (next_attempt_at, created_at)
  where status in ('queued', 'failed', 'processing') and attempts < 5;

alter table public.element_asset_jobs enable row level security;

drop policy if exists element_asset_jobs_select_admin
  on public.element_asset_jobs;
create policy element_asset_jobs_select_admin
on public.element_asset_jobs
for select
to authenticated
using ((select public.is_admin_operator()));

revoke all on table public.element_asset_jobs from public, anon, authenticated;
grant select on table public.element_asset_jobs to authenticated;
grant select, insert, update, delete on table public.element_asset_jobs to service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'element-intake',
  'element-intake',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists element_intake_storage_select_admin on storage.objects;
create policy element_intake_storage_select_admin
on storage.objects
for select
to authenticated
using (
  bucket_id = 'element-intake'
  and (select public.is_admin_operator())
);

drop policy if exists element_intake_storage_insert_admin on storage.objects;
create policy element_intake_storage_insert_admin
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'element-intake'
  and (select public.is_admin_operator())
);

drop policy if exists element_intake_storage_delete_admin on storage.objects;
create policy element_intake_storage_delete_admin
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'element-intake'
  and (select public.is_admin_operator())
);

drop policy if exists element_intake_storage_update_admin on storage.objects;
create policy element_intake_storage_update_admin
on storage.objects
for update
to authenticated
using (
  bucket_id = 'element-intake'
  and (select public.is_admin_operator())
)
with check (
  bucket_id = 'element-intake'
  and (select public.is_admin_operator())
);

create or replace function public.queue_element_assets(
  p_request_id text,
  p_element_id uuid,
  p_documents jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  payload jsonb;
  existing_job public.element_asset_jobs%rowtype;
  saved_job public.element_asset_jobs%rowtype;
  document_type text;
  storage_path text;
  source_mime_type text;
  source_size_bytes bigint;
  expected_prefix text;
begin
  if not public.is_admin_operator() then
    raise exception 'ADMIN_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  if p_element_id is null
    or nullif(btrim(p_request_id), '') is null
    or jsonb_typeof(coalesce(p_documents, '[]'::jsonb)) <> 'array'
  then
    raise exception 'INVALID_ELEMENT_ASSET_JOB' using errcode = '22023';
  end if;

  if not exists (select 1 from public.elements where id = p_element_id) then
    raise exception 'ELEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  expected_prefix := p_element_id::text || '/' || btrim(p_request_id) || '/';

  for payload in
    select value from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb))
  loop
    document_type := btrim(coalesce(payload ->> 'type', ''));
    storage_path := btrim(coalesce(payload ->> 'storagePath', ''));
    source_mime_type := lower(btrim(coalesce(payload ->> 'sourceMimeType', '')));
    source_size_bytes := coalesce((payload ->> 'sourceSizeBytes')::bigint, 0);

    if document_type not in (
      'birth_certificate',
      'curp',
      'medical_certificate',
      'enrollment_form',
      'guardian_id',
      'proof_of_address'
    )
      or storage_path not like expected_prefix || '%'
      or nullif(btrim(coalesce(payload ->> 'originalFilename', '')), '') is null
      or source_mime_type not in (
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/heic',
        'image/heif'
      )
      or source_size_bytes <= 0
      or source_size_bytes > 10485760
    then
      raise exception 'INVALID_ELEMENT_ASSET_JOB' using errcode = '22023';
    end if;
  end loop;

  select * into existing_job
  from public.element_asset_jobs
  where request_id = btrim(p_request_id)
  for update;

  if found then
    if existing_job.element_id <> p_element_id
      or existing_job.documents <> coalesce(p_documents, '[]'::jsonb)
    then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;

    saved_job := existing_job;
  else
    insert into public.element_asset_jobs (
      request_id,
      element_id,
      requested_by,
      documents
    ) values (
      btrim(p_request_id),
      p_element_id,
      (select auth.uid()),
      coalesce(p_documents, '[]'::jsonb)
    )
    returning * into saved_job;
  end if;

  return jsonb_build_object(
    'ok', true,
    'job', jsonb_build_object(
      'requestId', saved_job.request_id,
      'elementId', saved_job.element_id,
      'status', saved_job.status,
      'documents', saved_job.documents,
      'attempts', saved_job.attempts
    )
  );
end;
$$;

create or replace function public.claim_next_element_asset_job()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  claimed_job public.element_asset_jobs%rowtype;
  element_row public.elements%rowtype;
begin
  if not public.is_admin_operator() then
    raise exception 'ADMIN_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  select * into claimed_job
  from public.element_asset_jobs job
  where job.attempts < 5
    and job.next_attempt_at <= now()
    and (
      job.status in ('queued', 'failed')
      or (
        job.status = 'processing'
        and job.lock_expires_at is not null
        and job.lock_expires_at <= now()
      )
    )
  order by job.created_at
  for update skip locked
  limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'job', null);
  end if;

  update public.element_asset_jobs
  set
    status = 'processing',
    attempts = attempts + 1,
    locked_at = now(),
    lock_expires_at = now() + interval '3 minutes',
    last_error_code = null,
    last_error_message = null,
    updated_at = now()
  where request_id = claimed_job.request_id
  returning * into claimed_job;

  select * into element_row
  from public.elements
  where id = claimed_job.element_id;

  return jsonb_build_object(
    'ok', true,
    'job', jsonb_build_object(
      'requestId', claimed_job.request_id,
      'elementId', claimed_job.element_id,
      'elementCode', element_row.element_code,
      'folderName', upper(btrim(concat_ws(
        ' ',
        element_row.paternal_surname,
        element_row.maternal_surname,
        element_row.given_names
      ))),
      'documents', claimed_job.documents,
      'attempts', claimed_job.attempts
    )
  );
end;
$$;

create or replace function public.fail_element_asset_job(
  p_request_id text,
  p_error_code text,
  p_error_message text
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  changed public.element_asset_jobs%rowtype;
begin
  if not public.is_admin_operator() then
    raise exception 'ADMIN_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  update public.element_asset_jobs
  set
    status = 'failed',
    next_attempt_at = now() + make_interval(secs => least(greatest(attempts, 1), 5) * 30),
    locked_at = null,
    lock_expires_at = null,
    last_error_code = left(nullif(btrim(p_error_code), ''), 80),
    last_error_message = left(nullif(btrim(p_error_message), ''), 500),
    updated_at = now()
  where request_id = btrim(p_request_id)
    and status <> 'completed'
  returning * into changed;

  if not found then
    raise exception 'ELEMENT_ASSET_JOB_NOT_FOUND' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'ok', true,
    'job', jsonb_build_object(
      'requestId', changed.request_id,
      'status', changed.status,
      'attempts', changed.attempts,
      'nextAttemptAt', changed.next_attempt_at
    )
  );
end;
$$;

create or replace function public.complete_element_assets(
  p_request_id text,
  p_element_id uuid,
  p_drive_folder_id text,
  p_drive_folder_url text,
  p_qr_value text,
  p_documents jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
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
    update public.element_asset_jobs
    set
      status = 'completed',
      result = replay,
      completed_at = coalesce(completed_at, now()),
      locked_at = null,
      lock_expires_at = null,
      updated_at = now()
    where request_id = btrim(p_request_id);
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

  update public.element_asset_jobs
  set
    status = 'completed',
    result = response,
    completed_at = now(),
    locked_at = null,
    lock_expires_at = null,
    updated_at = now()
  where request_id = btrim(p_request_id)
    and element_id = p_element_id;

  perform public._frontend_complete_request(p_request_id, response, 200);
  return response;
end;
$$;

revoke all on function public.queue_element_assets(text, uuid, jsonb) from public;
revoke all on function public.claim_next_element_asset_job() from public;
revoke all on function public.fail_element_asset_job(text, text, text) from public;
revoke all on function public.complete_element_assets(text, uuid, text, text, text, jsonb) from public;

grant execute on function public.queue_element_assets(text, uuid, jsonb) to authenticated, service_role;
grant execute on function public.claim_next_element_asset_job() to authenticated, service_role;
grant execute on function public.fail_element_asset_job(text, text, text) to authenticated, service_role;
grant execute on function public.complete_element_assets(text, uuid, text, text, text, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

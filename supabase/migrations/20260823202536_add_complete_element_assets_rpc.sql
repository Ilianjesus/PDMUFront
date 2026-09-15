begin;

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

revoke all on function public.complete_element_assets(text, uuid, text, text, text, jsonb) from public;
grant execute on function public.complete_element_assets(text, uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.complete_element_assets(text, uuid, text, text, text, jsonb) to service_role;

notify pgrst, 'reload schema';

commit;

-- Private bucket for element document PDFs uploaded from the authenticated app.
-- The frontend uses VITE_SUPABASE_DOCUMENTS_BUCKET, defaulting to element-documents.

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

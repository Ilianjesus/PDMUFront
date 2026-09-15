#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTAINER_NAME="pdmu-schema-$RANDOM-$$"
POSTGRES_PASSWORD="pdmu-local-validation"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --detach --rm \
  --name "$CONTAINER_NAME" \
  --env POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  postgres:16-alpine >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$CONTAINER_NAME" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec -i "$CONTAINER_NAME" psql -v ON_ERROR_STOP=1 -U postgres <<'SQL'
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists auth;
create table auth.users (
  id uuid primary key default extensions.gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as
$$ select current_setting('request.jwt.claim.role', true) $$;

create schema if not exists storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default extensions.gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null,
  owner_id text
);
create function storage.foldername(name text) returns text[] language sql immutable as
$$ select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;
SQL

while IFS= read -r migration; do
  echo "$(basename "$migration") | RUN"
  docker exec -i "$CONTAINER_NAME" psql \
    -v ON_ERROR_STOP=1 \
    -U postgres \
    -f - < "$migration"
  echo "$(basename "$migration") | PASS"
done < <(find "$ROOT_DIR/supabase/migrations" -maxdepth 1 -type f -name '*.sql' | sort)

docker exec -i "$CONTAINER_NAME" psql -v ON_ERROR_STOP=1 -U postgres <<'SQL'
set request.jwt.claim.role = 'service_role';

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values (
  '00000000-0000-4000-8000-000000000001',
  'admin@pdmu.test',
  '{"display_name":"Administración PDMU"}',
  '{"pdmu_role":"admin","pdmu_status":"active"}'
);

set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

insert into public.elements (
  id,
  element_code,
  given_names,
  paternal_surname,
  maternal_surname,
  birth_date,
  sex_code,
  guardian_name,
  guardian_phone,
  enrolled_on,
  billing_start_on,
  status,
  is_self_tutor
) values (
  '00000000-0000-4000-8000-000000000010',
  'PDMU-TEST-001',
  'Alex',
  'Prueba',
  'Local',
  '2000-01-15',
  'F',
  'Nombre anterior',
  '5512345678',
  '2026-08-01',
  '2026-08-01',
  'active',
  true
);

do $$
begin
  if (
    select guardian_name
    from public.elements
    where id = '00000000-0000-4000-8000-000000000010'
  ) <> 'Alex Prueba Local' then
    raise exception 'SELF_TUTOR_SYNC_FAILED';
  end if;
end
$$;

select public.register_element_document(
  '00000000-0000-4000-8000-000000000020',
  '00000000-0000-4000-8000-000000000010',
  'curp',
  'storage:element-documents/00000000-0000-4000-8000-000000000010/curp/test.pdf',
  'curp.pdf',
  'application/pdf',
  1024
);

select public.queue_element_assets(
  '00000000-0000-4000-8000-000000000021',
  '00000000-0000-4000-8000-000000000010',
  '[]'::jsonb
);

select public.queue_element_assets(
  '00000000-0000-4000-8000-000000000021',
  '00000000-0000-4000-8000-000000000010',
  '[]'::jsonb
);

select public.claim_next_element_asset_job();

select public.complete_element_assets(
  '00000000-0000-4000-8000-000000000021',
  '00000000-0000-4000-8000-000000000010',
  'drive-folder-test',
  'https://drive.google.com/drive/folders/drive-folder-test',
  'pdmu:element:00000000-0000-4000-8000-000000000010',
  '[{"type":"birth_certificate","fileId":"drive-file-test","url":"https://drive.google.com/file/d/drive-file-test/view","originalFilename":"acta.jpg","mimeType":"application/pdf","sizeBytes":2048}]'::jsonb
);

select public.complete_element_assets(
  '00000000-0000-4000-8000-000000000021',
  '00000000-0000-4000-8000-000000000010',
  'drive-folder-test',
  'https://drive.google.com/drive/folders/drive-folder-test',
  'pdmu:element:00000000-0000-4000-8000-000000000010',
  '[{"type":"birth_certificate","fileId":"drive-file-test","url":"https://drive.google.com/file/d/drive-file-test/view","originalFilename":"acta.jpg","mimeType":"application/pdf","sizeBytes":2048}]'::jsonb
);

do $$
begin
  if (
    select count(*)
    from public.element_documents
    where element_id = '00000000-0000-4000-8000-000000000010'
      and document_type = 'birth_certificate'
      and status = 'active'
  ) <> 1 then
    raise exception 'ASSET_IDEMPOTENCY_FAILED';
  end if;

  if (
    select drive_folder_id
    from public.elements
    where id = '00000000-0000-4000-8000-000000000010'
  ) <> 'drive-folder-test' then
    raise exception 'ASSET_FOLDER_PERSISTENCE_FAILED';
  end if;

  if (
    select status
    from public.element_asset_jobs
    where request_id = '00000000-0000-4000-8000-000000000021'
  ) <> 'completed' then
    raise exception 'ASSET_JOB_COMPLETION_FAILED';
  end if;
end
$$;

select public.queue_element_assets(
  '00000000-0000-4000-8000-000000000022',
  '00000000-0000-4000-8000-000000000010',
  '[]'::jsonb
);

update public.element_asset_jobs
set status = 'failed', attempts = 5, next_attempt_at = now()
where request_id = '00000000-0000-4000-8000-000000000022';

do $$
declare
  claimed jsonb;
begin
  claimed := public.claim_next_element_asset_job();
  if claimed #>> '{job,requestId}' <> '00000000-0000-4000-8000-000000000022'
    or (claimed #>> '{job,attempts}')::integer <> 6
  then
    raise exception 'ASSET_JOB_RETRY_RECOVERY_FAILED';
  end if;
end
$$;

do $$
begin
  begin
    update public.operator_profiles
    set status = 'inactive'
    where id = '00000000-0000-4000-8000-000000000001';
    raise exception 'LAST_ADMIN_PROTECTION_FAILED';
  exception
    when check_violation then null;
  end;
end
$$;

set request.jwt.claim.role = 'service_role';
select public.get_operations_digest();
select public.get_document_compliance_queue();
select (public.get_operational_statistics() ->> 'ok')::boolean as statistics_ok;
select (public.get_dashboard_summary() ->> 'ok')::boolean as dashboard_ok;
select count(*) as migration_objects
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public';
SQL

echo "full_product_schema_validation | PASS"

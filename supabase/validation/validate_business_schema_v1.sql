-- Structural validation for PDMU business schema v1.
-- Run after 202606290001_business_schema_v1.sql in a Supabase development project.
-- The script is read-only and raises an exception on the first failed assertion.

do $$
declare
  expected_table text;
begin
  foreach expected_table in array array[
    'operator_profiles',
    'elements',
    'element_documents',
    'payments',
    'attendance_records',
    'audit_log',
    'idempotency_keys'
  ]
  loop
    if to_regclass(format('public.%I', expected_table)) is null then
      raise exception 'Missing table public.%', expected_table;
    end if;
  end loop;
end;
$$;

do $$
declare
  expected record;
begin
  for expected in
    select *
    from (values
      ('operator_profiles', 'id'),
      ('operator_profiles', 'role'),
      ('operator_profiles', 'status'),
      ('elements', 'id'),
      ('elements', 'element_code'),
      ('elements', 'version'),
      ('elements', 'drive_folder_id'),
      ('element_documents', 'element_id'),
      ('element_documents', 'document_type'),
      ('element_documents', 'replaces_document_id'),
      ('element_documents', 'status'),
      ('payments', 'payment_code'),
      ('payments', 'element_id'),
      ('payments', 'amount_cents'),
      ('payments', 'cancelled_at'),
      ('payments', 'version'),
      ('attendance_records', 'attendance_code'),
      ('attendance_records', 'element_id'),
      ('attendance_records', 'occurred_at'),
      ('attendance_records', 'attendance_date'),
      ('attendance_records', 'record_status'),
      ('attendance_records', 'version'),
      ('audit_log', 'actor_user_id'),
      ('audit_log', 'before_data'),
      ('audit_log', 'after_data'),
      ('audit_log', 'request_id'),
      ('idempotency_keys', 'key'),
      ('idempotency_keys', 'request_hash'),
      ('idempotency_keys', 'response'),
      ('idempotency_keys', 'expires_at')
    ) as columns(table_name, column_name)
  loop
    if not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = expected.table_name
        and c.column_name = expected.column_name
    ) then
      raise exception 'Missing column public.%.%', expected.table_name, expected.column_name;
    end if;
  end loop;
end;
$$;

do $$
declare
  expected_table text;
begin
  foreach expected_table in array array[
    'operator_profiles',
    'elements',
    'element_documents',
    'payments',
    'attendance_records',
    'audit_log',
    'idempotency_keys'
  ]
  loop
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = expected_table
        and c.relkind = 'r'
        and c.relrowsecurity
    ) then
      raise exception 'RLS is not enabled on public.%', expected_table;
    end if;

    if has_table_privilege('anon', format('public.%I', expected_table), 'SELECT')
      or has_table_privilege('anon', format('public.%I', expected_table), 'INSERT')
      or has_table_privilege('anon', format('public.%I', expected_table), 'UPDATE')
      or has_table_privilege('anon', format('public.%I', expected_table), 'DELETE')
    then
      raise exception 'anon has direct privileges on public.%', expected_table;
    end if;

    if has_table_privilege('authenticated', format('public.%I', expected_table), 'SELECT')
      or has_table_privilege('authenticated', format('public.%I', expected_table), 'INSERT')
      or has_table_privilege('authenticated', format('public.%I', expected_table), 'UPDATE')
      or has_table_privilege('authenticated', format('public.%I', expected_table), 'DELETE')
    then
      raise exception 'authenticated has direct privileges on public.%', expected_table;
    end if;
  end loop;

  foreach expected_table in array array[
    'operator_profiles',
    'elements',
    'element_documents',
    'payments',
    'attendance_records',
    'audit_log'
  ]
  loop
    if has_table_privilege('service_role', format('public.%I', expected_table), 'DELETE') then
      raise exception 'service_role has forbidden physical DELETE on public.%', expected_table;
    end if;
  end loop;

  if has_table_privilege('service_role', 'public.audit_log', 'UPDATE') then
    raise exception 'service_role has forbidden UPDATE on append-only public.audit_log';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'operator_profiles',
        'elements',
        'element_documents',
        'payments',
        'attendance_records',
        'audit_log',
        'idempotency_keys'
      ])
  ) then
    raise exception 'Unexpected RLS policies exist on business schema v1 tables';
  end if;
end;
$$;

do $$
declare
  expected_index text;
begin
  foreach expected_index in array array[
    'operator_profiles_email_lower_uidx',
    'elements_element_code_lower_uidx',
    'elements_status_idx',
    'elements_given_names_trgm_idx',
    'elements_paternal_surname_trgm_idx',
    'element_documents_active_type_uidx',
    'element_documents_drive_file_id_uidx',
    'payments_active_period_uidx',
    'payments_payment_code_lower_uidx',
    'payments_element_year_idx',
    'attendance_code_lower_uidx',
    'attendance_element_occurred_idx',
    'attendance_date_status_idx',
    'audit_log_entity_idx',
    'audit_log_request_id_idx',
    'idempotency_keys_expires_at_idx'
  ]
  loop
    if to_regclass(format('public.%I', expected_index)) is null then
      raise exception 'Missing index public.%', expected_index;
    end if;
  end loop;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'payments_active_period_uidx'
      and indexdef ilike '%where (status = ''posted''%'
  ) then
    raise exception 'payments_active_period_uidx is not the expected partial index';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'element_documents_active_type_uidx'
      and indexdef ilike '%where (status = ''active''%'
  ) then
    raise exception 'element_documents_active_type_uidx is not the expected partial index';
  end if;
end;
$$;

do $$
declare
  expected_constraint text;
begin
  foreach expected_constraint in array array[
    'operator_profiles_id_fkey',
    'operator_profiles_role_check',
    'elements_status_check',
    'elements_version_positive',
    'element_documents_element_id_fkey',
    'element_documents_replaces_document_id_fkey',
    'element_documents_replaced_at_check',
    'payments_element_id_fkey',
    'payments_month_check',
    'payments_cancellation_check',
    'attendance_records_element_id_fkey',
    'attendance_status_check',
    'attendance_cancellation_check',
    'idempotency_status_check',
    'idempotency_expiration_check'
  ]
  loop
    if not exists (
      select 1
      from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      where n.nspname = 'public'
        and c.conname = expected_constraint
    ) then
      raise exception 'Missing constraint public.%', expected_constraint;
    end if;
  end loop;
end;
$$;

do $$
declare
  expected_trigger text;
begin
  foreach expected_trigger in array array[
    'operator_profiles_set_updated_at',
    'elements_set_updated_at',
    'element_documents_enforce_created_at',
    'payments_set_updated_at',
    'attendance_records_set_metadata',
    'audit_log_enforce_created_at',
    'idempotency_keys_enforce_created_at',
    'audit_log_append_only'
  ]
  loop
    if not exists (
      select 1
      from pg_trigger
      where tgname = expected_trigger
        and not tgisinternal
    ) then
      raise exception 'Missing trigger %', expected_trigger;
    end if;
  end loop;
end;
$$;

do $$
begin
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Missing function public.set_updated_at()';
  end if;

  if to_regprocedure('public.set_updated_at_and_increment_version()') is null then
    raise exception 'Missing function public.set_updated_at_and_increment_version()';
  end if;

  if to_regprocedure('public.enforce_created_at()') is null then
    raise exception 'Missing function public.enforce_created_at()';
  end if;

  if to_regprocedure('public.set_attendance_date_and_update_metadata()') is null then
    raise exception 'Missing function public.set_attendance_date_and_update_metadata()';
  end if;

  if to_regprocedure('public.prevent_audit_log_mutation()') is null then
    raise exception 'Missing function public.prevent_audit_log_mutation()';
  end if;

  if not exists (
    select 1 from pg_extension where extname = 'pgcrypto'
  ) then
    raise exception 'Missing pgcrypto extension';
  end if;

  if not exists (
    select 1 from pg_extension where extname = 'pg_trgm'
  ) then
    raise exception 'Missing pg_trgm extension';
  end if;
end;
$$;

select
  'PASS' as validation_status,
  'business schema v1 structure, RLS, privileges, indexes, constraints, triggers and functions are present' as detail;

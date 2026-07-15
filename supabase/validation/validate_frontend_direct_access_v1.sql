-- Read-only structural validation for 202606290002_frontend_direct_access_v1.sql.
-- Run after the migration. Raises on the first failed assertion.

do $$
declare
  expected_function text;
begin
  foreach expected_function in array array[
    'public.current_operator_profile()',
    'public.current_operator_role()',
    'public.is_active_operator()',
    'public.is_admin_operator()',
    'public.search_elements(text,integer,text)',
    'public.get_element(uuid)',
    'public.create_element(text,text,text,date,text,text,text,text,text,text)',
    'public.record_payment(text,uuid,integer,integer,text,text)',
    'public.list_payments(uuid,integer,integer)',
    'public.record_attendance(text,uuid,text,text)',
    'public.list_attendance(uuid,date,date,integer)',
    'public.cancel_payment(text,uuid,integer,text)',
    'public.cancel_attendance(text,uuid,integer,text)',
    'public.get_dashboard_summary()'
  ]
  loop
    if to_regprocedure(expected_function) is null then
      raise exception 'Missing function %', expected_function;
    end if;
  end loop;

  if to_regclass('public.payment_fee_schedule') is null then
    raise exception 'Missing table public.payment_fee_schedule';
  end if;
end;
$$;

do $$
declare
  expected record;
begin
  for expected in
    select * from (values
      ('operator_profiles', 'operator_profiles_select_self_or_admin', 'SELECT'),
      ('elements', 'elements_select_visible', 'SELECT'),
      ('elements', 'elements_insert_admin', 'INSERT'),
      ('elements', 'elements_update_admin', 'UPDATE'),
      ('element_documents', 'element_documents_select_visible', 'SELECT'),
      ('element_documents', 'element_documents_insert_admin', 'INSERT'),
      ('element_documents', 'element_documents_update_admin', 'UPDATE'),
      ('payments', 'payments_select_active_operator', 'SELECT'),
      ('attendance_records', 'attendance_select_active_operator', 'SELECT'),
      ('audit_log', 'audit_log_select_admin', 'SELECT')
    ) as policies(table_name, policy_name, command_name)
  loop
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = expected.table_name
        and policyname = expected.policy_name
        and cmd = expected.command_name
        and roles = array['authenticated'::name]
    ) then
      raise exception 'Missing or invalid policy public.%.%', expected.table_name, expected.policy_name;
    end if;
  end loop;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'operator_profiles', 'elements', 'element_documents', 'payments',
        'attendance_records', 'audit_log', 'idempotency_keys', 'payment_fee_schedule'
      )
      and (
        roles && array['anon'::name]
        or coalesce(qual, '') in ('true', '(true)')
        or coalesce(with_check, '') in ('true', '(true)')
      )
  ) then
    raise exception 'Unsafe anon or unconditional business-table policy detected';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('elements', 'element_documents', 'payments', 'attendance_records', 'audit_log')
      and cmd = 'DELETE'
  ) then
    raise exception 'Physical DELETE policy detected on a business table';
  end if;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'operator_profiles', 'elements', 'element_documents', 'payments',
    'attendance_records', 'audit_log', 'idempotency_keys', 'payment_fee_schedule'
  ]
  loop
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = table_name
        and c.relrowsecurity
    ) then
      raise exception 'RLS is not enabled on public.%', table_name;
    end if;

    if has_table_privilege('anon', format('public.%I', table_name), 'SELECT')
      or has_table_privilege('anon', format('public.%I', table_name), 'INSERT')
      or has_table_privilege('anon', format('public.%I', table_name), 'UPDATE')
      or has_table_privilege('anon', format('public.%I', table_name), 'DELETE')
    then
      raise exception 'anon has direct privileges on public.%', table_name;
    end if;

    if has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE') then
      raise exception 'authenticated has physical DELETE on public.%', table_name;
    end if;

    if table_name <> 'idempotency_keys'
      and has_table_privilege('service_role', format('public.%I', table_name), 'DELETE')
    then
      raise exception 'service_role has physical DELETE on public.%', table_name;
    end if;
  end loop;

  if not has_table_privilege('authenticated', 'public.operator_profiles', 'SELECT')
    or not has_table_privilege('authenticated', 'public.elements', 'SELECT')
    or not has_table_privilege('authenticated', 'public.elements', 'INSERT')
    or not has_table_privilege('authenticated', 'public.elements', 'UPDATE')
    or not has_table_privilege('authenticated', 'public.element_documents', 'SELECT')
    or not has_table_privilege('authenticated', 'public.element_documents', 'INSERT')
    or not has_table_privilege('authenticated', 'public.element_documents', 'UPDATE')
    or not has_table_privilege('authenticated', 'public.payments', 'SELECT')
    or not has_table_privilege('authenticated', 'public.attendance_records', 'SELECT')
    or not has_table_privilege('authenticated', 'public.audit_log', 'SELECT')
  then
    raise exception 'authenticated is missing an expected direct table privilege';
  end if;

  if has_table_privilege('authenticated', 'public.payments', 'INSERT')
    or has_table_privilege('authenticated', 'public.payments', 'UPDATE')
    or has_table_privilege('authenticated', 'public.attendance_records', 'INSERT')
    or has_table_privilege('authenticated', 'public.attendance_records', 'UPDATE')
    or has_table_privilege('authenticated', 'public.audit_log', 'INSERT')
    or has_table_privilege('authenticated', 'public.audit_log', 'UPDATE')
    or has_table_privilege('authenticated', 'public.idempotency_keys', 'SELECT')
    or has_table_privilege('authenticated', 'public.idempotency_keys', 'INSERT')
    or has_table_privilege('authenticated', 'public.idempotency_keys', 'UPDATE')
    or has_table_privilege('authenticated', 'public.payment_fee_schedule', 'SELECT')
    or has_table_privilege('authenticated', 'public.payment_fee_schedule', 'INSERT')
    or has_table_privilege('authenticated', 'public.payment_fee_schedule', 'UPDATE')
  then
    raise exception 'authenticated has a forbidden sensitive-table privilege';
  end if;
end;
$$;

do $$
declare
  api_function record;
begin
  for api_function in
    select p.oid, p.proname, p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'current_operator_profile', 'current_operator_role', 'is_active_operator',
        'is_admin_operator', 'search_elements', 'get_element', 'create_element',
        'record_payment', 'list_payments', 'record_attendance', 'list_attendance',
        'cancel_payment', 'cancel_attendance', 'get_dashboard_summary'
      )
  loop
    if not api_function.prosecdef then
      raise exception 'Expected SECURITY DEFINER on public.%', api_function.proname;
    end if;
    if has_function_privilege('anon', api_function.oid, 'EXECUTE') then
      raise exception 'anon can execute public.%', api_function.proname;
    end if;
    if not has_function_privilege('authenticated', api_function.oid, 'EXECUTE') then
      raise exception 'authenticated cannot execute public.%', api_function.proname;
    end if;
  end loop;

  if has_function_privilege(
    'authenticated', 'public._frontend_claim_request(text,text,text)', 'EXECUTE'
  ) or has_function_privilege(
    'authenticated', 'public._frontend_complete_request(text,jsonb,integer)', 'EXECUTE'
  ) or has_function_privilege(
    'anon', 'public._frontend_claim_request(text,text,text)', 'EXECUTE'
  ) or has_function_privilege(
    'anon', 'public._frontend_complete_request(text,jsonb,integer)', 'EXECUTE'
  ) then
    raise exception 'An API role can execute an internal idempotency helper';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'audit_log'
      and t.tgname = 'audit_log_append_only'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ) then
    raise exception 'audit_log append-only trigger is missing or disabled';
  end if;

  if has_table_privilege('authenticated', 'public.audit_log', 'INSERT')
    or has_table_privilege('authenticated', 'public.audit_log', 'UPDATE')
    or has_table_privilege('authenticated', 'public.audit_log', 'DELETE')
    or has_table_privilege('service_role', 'public.audit_log', 'UPDATE')
    or has_table_privilege('service_role', 'public.audit_log', 'DELETE')
  then
    raise exception 'audit_log is not append-only for API roles';
  end if;
end;
$$;

select
  'PASS' as validation_status,
  'frontend direct access v1 helpers, RLS, grants and append-only audit are valid' as detail;

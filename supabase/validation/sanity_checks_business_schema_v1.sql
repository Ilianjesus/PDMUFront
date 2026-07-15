-- Behavioral sanity checks for PDMU business schema v1.
-- Requires seed_business_schema_v1.sql.
-- All changes are wrapped in a transaction and rolled back.

begin;

do $$
begin
  if not exists (
    select 1 from public.elements
    where id = '00000000-0000-4000-8000-000000000101'
  ) then
    raise exception 'Seed element is missing. Run seed_business_schema_v1.sql first.';
  end if;

  if not exists (
    select 1 from public.payments
    where id = '00000000-0000-4000-8000-000000000301'
      and status = 'posted'
  ) then
    raise exception 'Seed payment is missing or not active.';
  end if;

  if not exists (
    select 1 from public.element_documents
    where id = '00000000-0000-4000-8000-000000000201'
      and status = 'active'
  ) then
    raise exception 'Seed document is missing or not active.';
  end if;

  if not exists (
    select 1 from public.attendance_records
    where id = '00000000-0000-4000-8000-000000000401'
  ) then
    raise exception 'Seed attendance is missing.';
  end if;
end;
$$;

do $$
declare
  rejected boolean := false;
begin
  begin
    insert into public.payments (
      id, payment_code, element_id, year, month, amount_cents, method
    ) values (
      '00000000-0000-4000-8000-000000000302',
      'PAY-SANITY-DUPLICATE',
      '00000000-0000-4000-8000-000000000101',
      2026,
      6,
      20000,
      'cash'
    );
  exception
    when unique_violation then
      rejected := true;
  end;

  if not rejected then
    raise exception 'Duplicate active payment was unexpectedly accepted';
  end if;
end;
$$;

do $$
declare
  rejected boolean := false;
begin
  begin
    insert into public.element_documents (
      id, element_id, document_type, drive_file_id, status
    ) values (
      '00000000-0000-4000-8000-000000000202',
      '00000000-0000-4000-8000-000000000101',
      'birth_certificate',
      'drive-file-sanity-duplicate',
      'active'
    );
  exception
    when unique_violation then
      rejected := true;
  end;

  if not rejected then
    raise exception 'Duplicate active document type was unexpectedly accepted';
  end if;
end;
$$;

do $$
declare
  before_version integer;
  after_version integer;
  original_created_at timestamptz;
  resulting_created_at timestamptz;
begin
  select version, created_at
  into before_version, original_created_at
  from public.elements
  where id = '00000000-0000-4000-8000-000000000101';

  update public.elements
  set group_code = 'SEED-UPDATED',
      version = 999,
      created_at = now() + interval '10 days'
  where id = '00000000-0000-4000-8000-000000000101';

  select version, created_at
  into after_version, resulting_created_at
  from public.elements
  where id = '00000000-0000-4000-8000-000000000101';

  if after_version <> before_version + 1 then
    raise exception 'Element version did not increment exactly once';
  end if;

  if resulting_created_at <> original_created_at then
    raise exception 'Element created_at was unexpectedly mutable';
  end if;
end;
$$;

do $$
declare
  inserted_version integer;
  inserted_created_at timestamptz;
  inserted_updated_at timestamptz;
begin
  insert into public.elements (
    id,
    element_code,
    given_names,
    paternal_surname,
    birth_date,
    sex_code,
    guardian_name,
    guardian_phone,
    version,
    created_at,
    updated_at
  ) values (
    '00000000-0000-4000-8000-000000000102',
    'PDMU-SANITY-METADATA',
    'Metadata',
    'Sanity',
    date '2011-01-01',
    'F',
    'Tutor Sanity',
    '5500000001',
    999,
    timestamptz '2000-01-01 00:00:00+00',
    timestamptz '2000-01-01 00:00:00+00'
  );

  select version, created_at, updated_at
  into inserted_version, inserted_created_at, inserted_updated_at
  from public.elements
  where id = '00000000-0000-4000-8000-000000000102';

  if inserted_version <> 1 then
    raise exception 'Element insert accepted a client-provided version';
  end if;

  if inserted_created_at < statement_timestamp() - interval '1 minute'
    or inserted_updated_at <> inserted_created_at
  then
    raise exception 'Element insert accepted client-provided creation metadata';
  end if;
end;
$$;

do $$
declare
  before_version integer;
  after_version integer;
  original_created_at timestamptz;
  resulting_created_at timestamptz;
begin
  select version, created_at into before_version, original_created_at
  from public.payments
  where id = '00000000-0000-4000-8000-000000000301';

  update public.payments
  set reference = 'SANITY-VERSION-CHECK',
      version = 999,
      created_at = timestamptz '2000-01-01 00:00:00+00'
  where id = '00000000-0000-4000-8000-000000000301';

  select version, created_at into after_version, resulting_created_at
  from public.payments
  where id = '00000000-0000-4000-8000-000000000301';

  if after_version <> before_version + 1 then
    raise exception 'Payment version did not increment exactly once';
  end if;

  if resulting_created_at <> original_created_at then
    raise exception 'Payment created_at was unexpectedly mutable';
  end if;
end;
$$;

do $$
declare
  before_version integer;
  after_version integer;
  derived_date date;
  original_created_at timestamptz;
  resulting_created_at timestamptz;
begin
  select version, created_at into before_version, original_created_at
  from public.attendance_records
  where id = '00000000-0000-4000-8000-000000000401';

  update public.attendance_records
  set status = 'late',
      occurred_at = timestamptz '2026-06-30 00:30:00+00',
      attendance_date = date '2000-01-01',
      version = 999,
      created_at = timestamptz '2000-01-01 00:00:00+00'
  where id = '00000000-0000-4000-8000-000000000401';

  select version, attendance_date, created_at
  into after_version, derived_date, resulting_created_at
  from public.attendance_records
  where id = '00000000-0000-4000-8000-000000000401';

  if after_version <> before_version + 1 then
    raise exception 'Attendance version did not increment exactly once';
  end if;

  if derived_date <> date '2026-06-29' then
    raise exception 'attendance_date was not derived in America/Mexico_City';
  end if;

  if resulting_created_at <> original_created_at then
    raise exception 'Attendance created_at was unexpectedly mutable';
  end if;
end;
$$;

do $$
begin
  update public.payments
  set status = 'cancelled',
      cancelled_at = now(),
      cancel_reason = 'Sanity check cancellation'
  where id = '00000000-0000-4000-8000-000000000301';

  insert into public.payments (
    id, payment_code, element_id, year, month, amount_cents, method
  ) values (
    '00000000-0000-4000-8000-000000000303',
    'PAY-SANITY-REPLACEMENT',
    '00000000-0000-4000-8000-000000000101',
    2026,
    6,
    20000,
    'cash'
  );

  if not exists (
    select 1 from public.payments
    where id = '00000000-0000-4000-8000-000000000303'
      and status = 'posted'
  ) then
    raise exception 'Payment after cancellation was not inserted';
  end if;
end;
$$;

do $$
begin
  update public.element_documents
  set status = 'replaced',
      replaced_at = now(),
      created_at = timestamptz '2000-01-01 00:00:00+00'
  where id = '00000000-0000-4000-8000-000000000201';

  insert into public.element_documents (
    id,
    element_id,
    document_type,
    drive_file_id,
    status,
    version,
    replaces_document_id
  ) values (
    '00000000-0000-4000-8000-000000000203',
    '00000000-0000-4000-8000-000000000101',
    'birth_certificate',
    'drive-file-sanity-replacement',
    'active',
    2,
    '00000000-0000-4000-8000-000000000201'
  );

  if not exists (
    select 1 from public.element_documents
    where id = '00000000-0000-4000-8000-000000000203'
      and status = 'active'
  ) then
    raise exception 'Replacement document was not inserted';
  end if;

  if exists (
    select 1 from public.element_documents
    where id = '00000000-0000-4000-8000-000000000201'
      and created_at = timestamptz '2000-01-01 00:00:00+00'
  ) then
    raise exception 'Document created_at was unexpectedly mutable';
  end if;
end;
$$;

do $$
declare
  update_blocked boolean := false;
  delete_blocked boolean := false;
begin
  begin
    update public.audit_log
    set reason = 'This update must fail'
    where id = '00000000-0000-4000-8000-000000000501';
  exception
    when raise_exception then
      update_blocked := true;
  end;

  begin
    delete from public.audit_log
    where id = '00000000-0000-4000-8000-000000000501';
  exception
    when raise_exception then
      delete_blocked := true;
  end;

  if not update_blocked then
    raise exception 'audit_log UPDATE was unexpectedly accepted';
  end if;

  if not delete_blocked then
    raise exception 'audit_log DELETE was unexpectedly accepted';
  end if;
end;
$$;

do $$
declare
  audit_created_at timestamptz;
  idempotency_created_at timestamptz;
  original_idempotency_created_at timestamptz;
begin
  insert into public.audit_log (
    id,
    action,
    entity_type,
    entity_id,
    reason,
    created_at
  ) values (
    '00000000-0000-4000-8000-000000000502',
    'sanity.created_at.checked',
    'schema',
    'business-v1',
    'Temporary sanity fixture',
    timestamptz '2000-01-01 00:00:00+00'
  );

  select created_at into audit_created_at
  from public.audit_log
  where id = '00000000-0000-4000-8000-000000000502';

  if audit_created_at < statement_timestamp() - interval '1 minute' then
    raise exception 'audit_log insert accepted client-provided created_at';
  end if;

  select created_at into original_idempotency_created_at
  from public.idempotency_keys
  where key = 'idem-seed-business-schema-v1';

  update public.idempotency_keys
  set created_at = timestamptz '2000-01-01 00:00:00+00',
      response_status = 202
  where key = 'idem-seed-business-schema-v1';

  select created_at into idempotency_created_at
  from public.idempotency_keys
  where key = 'idem-seed-business-schema-v1';

  if idempotency_created_at <> original_idempotency_created_at then
    raise exception 'Idempotency created_at was unexpectedly mutable';
  end if;
end;
$$;

do $$
declare
  invalid_child_rejected boolean := false;
  parent_delete_rejected boolean := false;
begin
  begin
    insert into public.payments (
      id, payment_code, element_id, year, month, amount_cents, method
    ) values (
      '00000000-0000-4000-8000-000000000304',
      'PAY-SANITY-INVALID-ELEMENT',
      '00000000-0000-4000-8000-999999999999',
      2026,
      7,
      20000,
      'cash'
    );
  exception
    when foreign_key_violation then
      invalid_child_rejected := true;
  end;

  begin
    delete from public.elements
    where id = '00000000-0000-4000-8000-000000000101';
  exception
    when foreign_key_violation then
      parent_delete_rejected := true;
  end;

  if not invalid_child_rejected then
    raise exception 'Payment with unknown element was unexpectedly accepted';
  end if;

  if not parent_delete_rejected then
    raise exception 'Element with related records was unexpectedly deleted';
  end if;
end;
$$;

rollback;

select
  'PASS' as sanity_status,
  'uniqueness, replacement, versioning, audit immutability and foreign keys behave as expected' as detail;

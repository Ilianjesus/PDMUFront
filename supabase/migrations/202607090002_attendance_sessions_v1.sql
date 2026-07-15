-- Attendance sessions and activity model for PDMU APP.
-- Keeps legacy attendance records while adding session-based attendance.

begin;

create table if not exists public.attendance_activities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'activity',
  description text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_activities_name_not_blank check (btrim(name) <> ''),
  constraint attendance_activities_category_check check (category in ('mandatory', 'activity', 'event')),
  constraint attendance_activities_status_check check (status in ('active', 'inactive'))
);

create unique index if not exists attendance_activities_name_lower_uidx
  on public.attendance_activities (lower(btrim(name)));

create index if not exists attendance_activities_status_idx
  on public.attendance_activities (status, category);

drop trigger if exists attendance_activities_set_updated_at on public.attendance_activities;
create trigger attendance_activities_set_updated_at
before insert or update on public.attendance_activities
for each row execute function public.set_updated_at();

create table if not exists public.activity_sessions (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.attendance_activities (id) on delete restrict,
  session_date date not null,
  starts_at time,
  ends_at time,
  location text,
  attendance_scope text not null default 'open',
  attendance_required boolean not null default false,
  status text not null default 'scheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activity_sessions_scope_check check (attendance_scope in ('all_active', 'enrolled', 'open')),
  constraint activity_sessions_status_check check (status in ('scheduled', 'open', 'closed', 'cancelled')),
  constraint activity_sessions_time_check check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create index if not exists activity_sessions_calendar_idx
  on public.activity_sessions (session_date, status);

create index if not exists activity_sessions_activity_idx
  on public.activity_sessions (activity_id, session_date);

drop trigger if exists activity_sessions_set_updated_at on public.activity_sessions;
create trigger activity_sessions_set_updated_at
before insert or update on public.activity_sessions
for each row execute function public.set_updated_at();

create table if not exists public.element_activity_enrollments (
  id uuid primary key default gen_random_uuid(),
  element_id uuid not null references public.elements (id) on delete restrict,
  activity_id uuid not null references public.attendance_activities (id) on delete restrict,
  status text not null default 'enrolled',
  starts_on date not null default current_date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint element_activity_enrollments_status_check check (status in ('enrolled', 'dropped')),
  constraint element_activity_enrollments_dates_check check (ends_on is null or ends_on >= starts_on)
);

create unique index if not exists element_activity_enrollments_active_uidx
  on public.element_activity_enrollments (element_id, activity_id)
  where status = 'enrolled';

create index if not exists element_activity_enrollments_activity_idx
  on public.element_activity_enrollments (activity_id, status);

drop trigger if exists element_activity_enrollments_set_updated_at on public.element_activity_enrollments;
create trigger element_activity_enrollments_set_updated_at
before insert or update on public.element_activity_enrollments
for each row execute function public.set_updated_at();

create table if not exists public.element_attendance_exceptions (
  id uuid primary key default gen_random_uuid(),
  element_id uuid not null references public.elements (id) on delete restrict,
  scope text not null,
  weekday integer,
  session_id uuid references public.activity_sessions (id) on delete restrict,
  starts_on date not null default current_date,
  ends_on date,
  reason text not null,
  status text not null default 'active',
  created_by uuid references public.operator_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint element_attendance_exceptions_scope_check check (scope in ('weekday', 'date_range', 'session')),
  constraint element_attendance_exceptions_weekday_check check (weekday is null or weekday between 0 and 6),
  constraint element_attendance_exceptions_status_check check (status in ('active', 'inactive')),
  constraint element_attendance_exceptions_reason_not_blank check (btrim(reason) <> ''),
  constraint element_attendance_exceptions_dates_check check (ends_on is null or ends_on >= starts_on),
  constraint element_attendance_exceptions_scope_fields_check check (
    (scope = 'weekday' and weekday is not null and session_id is null)
    or (scope = 'session' and session_id is not null and weekday is null)
    or (scope = 'date_range' and session_id is null)
  )
);

create index if not exists element_attendance_exceptions_element_idx
  on public.element_attendance_exceptions (element_id, status, starts_on, ends_on);

create index if not exists element_attendance_exceptions_session_idx
  on public.element_attendance_exceptions (session_id, status);

drop trigger if exists element_attendance_exceptions_set_updated_at on public.element_attendance_exceptions;
create trigger element_attendance_exceptions_set_updated_at
before insert or update on public.element_attendance_exceptions
for each row execute function public.set_updated_at();

alter table public.attendance_records
  add column if not exists session_id uuid references public.activity_sessions (id) on delete restrict;

create unique index if not exists attendance_records_active_session_element_uidx
  on public.attendance_records (session_id, element_id)
  where session_id is not null and record_status = 'active';

create index if not exists attendance_records_session_idx
  on public.attendance_records (session_id, record_status);

alter table public.attendance_activities enable row level security;
alter table public.activity_sessions enable row level security;
alter table public.element_activity_enrollments enable row level security;
alter table public.element_attendance_exceptions enable row level security;

revoke all on table public.attendance_activities from anon, authenticated, service_role;
revoke all on table public.activity_sessions from anon, authenticated, service_role;
revoke all on table public.element_activity_enrollments from anon, authenticated, service_role;
revoke all on table public.element_attendance_exceptions from anon, authenticated, service_role;

grant select, insert, update on table public.attendance_activities to service_role;
grant select, insert, update on table public.activity_sessions to service_role;
grant select, insert, update on table public.element_activity_enrollments to service_role;
grant select, insert, update on table public.element_attendance_exceptions to service_role;

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

create or replace function public.is_element_exempt_from_session(
  p_element_id uuid,
  p_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
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

create or replace function public.upsert_attendance_activity(
  p_name text,
  p_category text default 'activity',
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function public.set_attendance_activity_status(
  p_activity_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function public.list_attendance_activities(
  p_include_inactive boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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

create or replace function public.create_activity_session(
  p_activity_id uuid,
  p_session_date date,
  p_starts_at time default null,
  p_ends_at time default null,
  p_location text default null,
  p_attendance_scope text default 'open',
  p_attendance_required boolean default false,
  p_status text default 'scheduled'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  insert into public.activity_sessions (
    activity_id, session_date, starts_at, ends_at, location,
    attendance_scope, attendance_required, status
  ) values (
    p_activity_id, p_session_date, p_starts_at, p_ends_at,
    nullif(btrim(p_location), ''), p_attendance_scope, p_attendance_required,
    p_status
  ) returning * into row_data;

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

create or replace function public.set_activity_session_status(
  p_session_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function public.list_activity_sessions(
  p_from date default null,
  p_to date default null,
  p_include_inactive boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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

drop function if exists public.record_attendance(text, uuid, text, text);

create or replace function public.record_attendance(
  p_request_id text,
  p_element_id uuid,
  p_status text default 'present',
  p_source text default 'manual',
  p_session_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function public.create_attendance_exception(
  p_element_id uuid,
  p_scope text,
  p_reason text,
  p_weekday integer default null,
  p_session_id uuid default null,
  p_starts_on date default null,
  p_ends_on date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function public.get_element_attendance_statement(
  p_element_id uuid,
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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

revoke all on function public.upsert_attendance_activity(text, text, text) from public, anon;
revoke all on function public.set_attendance_activity_status(uuid, text) from public, anon;
revoke all on function public.list_attendance_activities(boolean) from public, anon;
revoke all on function public.create_activity_session(uuid, date, time, time, text, text, boolean, text) from public, anon;
revoke all on function public.set_activity_session_status(uuid, text) from public, anon;
revoke all on function public.list_activity_sessions(date, date, boolean) from public, anon;
revoke all on function public.record_attendance(text, uuid, text, text, uuid) from public, anon;
revoke all on function public.create_attendance_exception(uuid, text, text, integer, uuid, date, date) from public, anon;
revoke all on function public.get_element_attendance_statement(uuid, date, date) from public, anon;

grant execute on function public.upsert_attendance_activity(text, text, text) to authenticated, service_role;
grant execute on function public.set_attendance_activity_status(uuid, text) to authenticated, service_role;
grant execute on function public.list_attendance_activities(boolean) to authenticated, service_role;
grant execute on function public.create_activity_session(uuid, date, time, time, text, text, boolean, text) to authenticated, service_role;
grant execute on function public.set_activity_session_status(uuid, text) to authenticated, service_role;
grant execute on function public.list_activity_sessions(date, date, boolean) to authenticated, service_role;
grant execute on function public.record_attendance(text, uuid, text, text, uuid) to authenticated, service_role;
grant execute on function public.create_attendance_exception(uuid, text, text, integer, uuid, date, date) to authenticated, service_role;
grant execute on function public.get_element_attendance_statement(uuid, date, date) to authenticated, service_role;

commit;

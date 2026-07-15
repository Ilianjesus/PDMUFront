-- Prevent duplicate attendance sessions for the same activity on the same day.
-- Existing duplicates are cancelled so the calendar only shows one operative session.

with ranked_sessions as (
  select
    s.id,
    row_number() over (
      partition by s.activity_id, s.session_date
      order by s.created_at asc, s.id asc
    ) as duplicate_rank
  from public.activity_sessions as s
  where s.status <> 'cancelled'
)
update public.activity_sessions as s
set
  status = 'cancelled',
  updated_at = now()
from ranked_sessions as ranked
where s.id = ranked.id
  and ranked.duplicate_rank > 1;

create unique index if not exists activity_sessions_active_activity_day_uidx
  on public.activity_sessions (activity_id, session_date)
  where status <> 'cancelled';

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

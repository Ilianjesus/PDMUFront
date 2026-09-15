begin;

-- A session is one attendance opportunity per activity and day. The existing
-- project had duplicate, unused sessions from development; keep their rows for
-- auditability, but cancel all except the earliest one.
do $$
begin
  if exists (
    select 1
    from public.activity_sessions s
    where s.status <> 'cancelled'
    group by s.activity_id, s.session_date
    having count(*) > 1
       and (
         count(distinct (s.starts_at, s.ends_at, s.location,
                         s.attendance_scope, s.attendance_required, s.status)) > 1
         or exists (
           select 1
           from public.activity_sessions linked
           where linked.activity_id = s.activity_id
             and linked.session_date = s.session_date
             and (
               exists (select 1 from public.attendance_records a where a.session_id = linked.id)
               or exists (select 1 from public.element_attendance_exceptions e where e.session_id = linked.id)
             )
         )
       )
  ) then
    raise exception 'DUPLICATE_SESSIONS_REQUIRE_MANUAL_REVIEW';
  end if;
end;
$$;

with ranked as (
  select id, row_number() over (
    partition by activity_id, session_date order by created_at, id
  ) as position
  from public.activity_sessions
  where status <> 'cancelled'
), cancelled as (
  update public.activity_sessions s
  set status = 'cancelled'
  from ranked r
  where s.id = r.id and r.position > 1
  returning s.id, s.activity_id, s.session_date
)
insert into public.audit_log (action, entity_type, entity_id, after_data, reason, request_id)
select 'activity_session.duplicate_cancelled', 'activity_session', id::text,
       jsonb_build_object('activityId', activity_id, 'sessionDate', session_date,
                          'status', 'cancelled'),
       'Consolidación de sesiones duplicadas sin asistencias',
       'canonical-schema-alignment-20260912'
from cancelled;

create unique index if not exists activity_sessions_active_activity_day_uidx
  on public.activity_sessions (activity_id, session_date)
  where status <> 'cancelled';

commit;

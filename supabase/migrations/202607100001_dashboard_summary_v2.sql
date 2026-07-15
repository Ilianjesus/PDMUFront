-- Dashboard summary aligned with billing_start_on and attendance sessions.

begin;

create or replace function public.get_dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today_mx date := (now() at time zone 'America/Mexico_City')::date;
  current_year integer := extract(year from (now() at time zone 'America/Mexico_City'))::integer;
  current_month integer := extract(month from (now() at time zone 'America/Mexico_City'))::integer;
  current_month_start date := date_trunc('month', now() at time zone 'America/Mexico_City')::date;
  active_elements integer;
  pending_payments integer;
  attendance_today integer;
  absences_today integer;
  documents_pending integer;
  important_alerts jsonb := '[]'::jsonb;
  recent_activity jsonb;
begin
  if not public.is_active_operator() then
    raise exception 'ACTIVE_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  select count(*)::integer
  into active_elements
  from public.elements as e
  where e.status = 'active';

  with active_element_periods as (
    select
      e.id as element_id,
      pfs.year,
      pfs.month
    from public.elements as e
    join public.payment_fee_schedule as pfs
      on pfs.status = 'active'
      and make_date(pfs.year, pfs.month, 1) >= date_trunc(
        'month',
        coalesce(e.billing_start_on, e.enrolled_on, (e.created_at at time zone 'America/Mexico_City')::date)
      )::date
      and make_date(pfs.year, pfs.month, 1) <= current_month_start
    where e.status = 'active'
  ),
  unpaid_periods as (
    select ep.element_id, ep.year, ep.month
    from active_element_periods as ep
    left join public.payments as p
      on p.element_id = ep.element_id
      and p.year = ep.year
      and p.month = ep.month
      and p.status = 'posted'
    where p.id is null
  )
  select count(*)::integer
  into pending_payments
  from unpaid_periods;

  select count(*)::integer
  into attendance_today
  from public.attendance_records as a
  join public.elements as e on e.id = a.element_id
  where e.status = 'active'
    and a.record_status = 'active'
    and a.status in ('present', 'late')
    and a.attendance_date = today_mx;

  select count(*)::integer
  into absences_today
  from public.attendance_records as a
  join public.elements as e on e.id = a.element_id
  where e.status = 'active'
    and a.record_status = 'active'
    and a.status = 'absent'
    and a.attendance_date = today_mx;

  select count(*)::integer
  into documents_pending
  from public.elements as e
  where e.status = 'active'
    and (
      select count(*)
      from public.element_documents as d
      where d.element_id = e.id
        and d.status = 'active'
    ) < 6;

  if pending_payments > 0 then
    important_alerts := important_alerts || jsonb_build_array(
      pending_payments::text || ' mensualidad(es) pendiente(s) hasta ' || current_month::text || '/' || current_year::text || '.'
    );
  end if;

  if documents_pending > 0 then
    important_alerts := important_alerts || jsonb_build_array(
      documents_pending::text || ' expediente(s) con documentación incompleta.'
    );
  end if;

  if absences_today > 0 then
    important_alerts := important_alerts || jsonb_build_array(
      absences_today::text || ' falta(s) registrada(s) hoy.'
    );
  end if;

  select coalesce(jsonb_agg(activity.label order by activity.occurred_at desc), '[]'::jsonb)
  into recent_activity
  from (
    select *
    from (
      select
        p.recorded_at as occurred_at,
        'Pago registrado: ' ||
          concat_ws(' ', e.given_names, e.paternal_surname, e.maternal_surname) ||
          ' - ' || p.month::text || '/' || p.year::text as label
      from public.payments as p
      join public.elements as e on e.id = p.element_id
      where p.status = 'posted'

      union all

      select
        a.occurred_at as occurred_at,
        'Asistencia registrada: ' ||
          concat_ws(' ', e.given_names, e.paternal_surname, e.maternal_surname) as label
      from public.attendance_records as a
      join public.elements as e on e.id = a.element_id
      where a.record_status = 'active'
    ) as all_activity
    order by occurred_at desc
    limit 5
  ) as activity;

  return jsonb_build_object(
    'ok', true,
    'resumenRapido', jsonb_build_object(
      'elementosActivos', active_elements,
      'pagosPendientes', pending_payments,
      'asistenciasHoy', attendance_today,
      'faltasHoy', absences_today
    ),
    'alertasImportantes', important_alerts,
    'actividadReciente', recent_activity
  );
end;
$$;

revoke all on function public.get_dashboard_summary() from public, anon;
grant execute on function public.get_dashboard_summary() to authenticated, service_role;

comment on function public.get_dashboard_summary() is
  'Returns the operational dashboard using current billing and attendance models.';

commit;

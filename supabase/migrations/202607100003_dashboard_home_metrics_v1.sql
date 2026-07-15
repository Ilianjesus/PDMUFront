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
  documents_pending integer;
  important_alerts jsonb := '[]'::jsonb;
begin
  if not public.is_active_operator() then
    raise exception 'ACTIVE_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  select count(*)::integer
  into active_elements
  from public.elements as e
  where e.status = 'active'
    and exists (
      select 1
      from public.element_enrollments as ee
      where ee.element_id = e.id
        and ee.status = 'active'
    );

  with active_enrollment_periods as (
    select
      ee.id as enrollment_id,
      current_year as year,
      current_month as month
    from public.element_enrollments as ee
    join public.elements as e on e.id = ee.element_id and e.status = 'active'
    where ee.status = 'active'
      and date_trunc('month', ee.billing_start_on)::date <= current_month_start
  ),
  unpaid_periods as (
    select ep.enrollment_id, ep.year, ep.month
    from active_enrollment_periods as ep
    left join public.payments as p
      on p.enrollment_id = ep.enrollment_id
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
      pending_payments::text || ' mensualidad(es) pendiente(s) de ' || current_month::text || '/' || current_year::text || '.'
    );
  end if;

  if documents_pending > 0 then
    important_alerts := important_alerts || jsonb_build_array(
      documents_pending::text || ' expediente(s) con documentación incompleta.'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'resumenRapido', jsonb_build_object(
      'elementosActivos', active_elements,
      'pagosPendientes', pending_payments,
      'asistenciasHoy', attendance_today
    ),
    'alertasImportantes', important_alerts,
    'actividadReciente', '[]'::jsonb
  );
end;
$$;

revoke all on function public.get_dashboard_summary() from public, anon;
grant execute on function public.get_dashboard_summary() to authenticated, service_role;

comment on function public.get_dashboard_summary() is
  'Returns the home dashboard metrics: active elements, current-month pending payments, today attendance, and important alerts.';

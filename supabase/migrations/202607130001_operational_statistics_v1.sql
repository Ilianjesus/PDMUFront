create or replace function public.get_operational_statistics(
  p_from date default null,
  p_to date default null,
  p_branch text default null,
  p_category text default null,
  p_activity text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today_mx date := (now() at time zone 'America/Mexico_City')::date;
  date_from date := coalesce(p_from, date_trunc('month', now() at time zone 'America/Mexico_City')::date);
  date_to date := coalesce(
    p_to,
    (date_trunc('month', now() at time zone 'America/Mexico_City') + interval '1 month - 1 day')::date
  );
  branch_filter text := nullif(lower(btrim(coalesce(p_branch, ''))), '');
  category_filter text := nullif(lower(btrim(coalesce(p_category, ''))), '');
  activity_filter text := nullif(translate(lower(btrim(coalesce(p_activity, ''))), 'áéíóúüñ', 'aeiouun'), '');
  date_from_month date := date_trunc('month', date_from)::date;
  date_to_month date := date_trunc('month', date_to)::date;
  result jsonb;
begin
  if not public.is_active_operator() then
    raise exception 'ACTIVE_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  if date_from > date_to or date_to - date_from > 366 then
    raise exception 'INVALID_STATISTICS_RANGE' using errcode = '22023';
  end if;

  with filtered_elements as (
    select
      e.id,
      e.given_names,
      e.paternal_surname,
      e.maternal_surname,
      concat_ws(' ', e.given_names, e.paternal_surname, e.maternal_surname) as display_name,
      e.birth_date,
      e.sex_code,
      public.calculate_element_group(e.birth_date, e.sex_code) as group_label
    from public.elements as e
    where e.status = 'active'
      and exists (
        select 1
        from public.element_enrollments as ee
        where ee.element_id = e.id
          and ee.status = 'active'
      )
      and (
        branch_filter is null
        or lower(public.calculate_element_group(e.birth_date, e.sex_code)) like '%' || branch_filter || '%'
      )
      and (
        category_filter is null
        or lower(public.calculate_element_group(e.birth_date, e.sex_code)) like '%' || category_filter || '%'
      )
  ),
  active_enrollments as (
    select
      ee.id,
      ee.element_id,
      ee.enrolled_on,
      ee.billing_start_on
    from public.element_enrollments as ee
    join filtered_elements as fe on fe.id = ee.element_id
    where ee.status = 'active'
  ),
  filtered_sessions as (
    select
      s.id,
      s.activity_id,
      s.session_date,
      s.attendance_required,
      a.name as activity_name,
      a.category
    from public.activity_sessions as s
    join public.attendance_activities as a on a.id = s.activity_id
    where s.status <> 'cancelled'
      and s.session_date between date_from and date_to
      and (
        activity_filter is null
        or (
          activity_filter = 'personalizado'
          and a.category = 'event'
        )
        or (
          activity_filter = 'instruccion'
          and translate(lower(a.name), 'áéíóúüñ', 'aeiouun') in ('instruccion', 'entrenamiento obligatorio')
        )
        or translate(lower(a.name), 'áéíóúüñ', 'aeiouun') = activity_filter
      )
  ),
  attendance_registered as (
    select ar.*
    from public.attendance_records as ar
    join filtered_elements as fe on fe.id = ar.element_id
    left join public.activity_sessions as s on s.id = ar.session_id
    left join public.attendance_activities as a on a.id = s.activity_id
    where ar.record_status = 'active'
      and ar.attendance_date between date_from and date_to
      and (
        activity_filter is null
        or (
          activity_filter = 'personalizado'
          and a.category = 'event'
        )
        or (
          activity_filter = 'instruccion'
          and translate(lower(coalesce(a.name, '')), 'áéíóúüñ', 'aeiouun') in ('instruccion', 'entrenamiento obligatorio')
        )
        or translate(lower(coalesce(a.name, '')), 'áéíóúüñ', 'aeiouun') = activity_filter
      )
  ),
  expected_required as (
    select
      fe.id as element_id,
      fe.display_name,
      fe.group_label,
      fs.id as session_id,
      fs.session_date,
      fs.activity_name,
      ar.id as attendance_id,
      ar.status as attendance_status,
      ex.id as exception_id
    from filtered_sessions as fs
    join active_enrollments as ae on ae.enrolled_on <= fs.session_date
    join filtered_elements as fe on fe.id = ae.element_id
    left join public.attendance_records as ar
      on ar.session_id = fs.id
      and ar.element_id = fe.id
      and ar.record_status = 'active'
    left join public.element_attendance_exceptions as ex
      on ex.element_id = fe.id
      and ex.status = 'active'
      and (
        (
          ex.scope = 'session'
          and ex.session_id = fs.id
        )
        or (
          ex.scope = 'weekday'
          and ex.weekday = extract(dow from fs.session_date)::integer
          and ex.starts_on <= fs.session_date
          and (ex.ends_on is null or ex.ends_on >= fs.session_date)
        )
        or (
          ex.scope = 'date_range'
          and ex.starts_on <= fs.session_date
          and (ex.ends_on is null or ex.ends_on >= fs.session_date)
        )
      )
    where fs.attendance_required = true
  ),
  attendance_attention as (
    select
      er.element_id,
      er.display_name,
      er.group_label,
      count(*)::integer as required_count,
      count(*) filter (where er.attendance_status in ('present', 'late'))::integer as present_count,
      count(*) filter (where er.attendance_status = 'excused' or er.exception_id is not null)::integer as excused_count,
      count(*) filter (
        where er.exception_id is null
          and (er.attendance_id is null or er.attendance_status = 'absent')
      )::integer as absence_count
    from expected_required as er
    group by er.element_id, er.display_name, er.group_label
  ),
  payment_periods as (
    select
      fe.id as element_id,
      fe.display_name,
      fe.group_label,
      ae.id as enrollment_id,
      period_start::date as period_start,
      extract(year from period_start)::integer as year,
      extract(month from period_start)::integer as month
    from filtered_elements as fe
    join active_enrollments as ae on ae.element_id = fe.id
    cross join lateral generate_series(
      greatest(date_trunc('month', ae.billing_start_on)::date, date_from_month),
      date_to_month,
      interval '1 month'
    ) as period_start
    where ae.billing_start_on <= date_to
  ),
  payment_attention_base as (
    select
      pp.element_id,
      pp.display_name,
      pp.group_label,
      count(*) filter (where p.id is null and fee.id is not null)::integer as pending_months,
      coalesce(sum(fee.amount_cents) filter (where p.id is null and fee.id is not null), 0)::integer as due_cents
    from payment_periods as pp
    left join public.payment_fee_schedule as fee
      on fee.year = pp.year
      and fee.month = pp.month
      and fee.status = 'active'
    left join public.payments as p
      on p.enrollment_id = pp.enrollment_id
      and p.year = pp.year
      and p.month = pp.month
      and p.status = 'posted'
    group by pp.element_id, pp.display_name, pp.group_label
  ),
  last_payments as (
    select
      p.element_id,
      max(p.recorded_at) as last_payment_at
    from public.payments as p
    join filtered_elements as fe on fe.id = p.element_id
    where p.status = 'posted'
    group by p.element_id
  ),
  payment_attention as (
    select
      pab.element_id,
      pab.display_name,
      pab.group_label,
      pab.pending_months,
      pab.due_cents,
      lp.last_payment_at
    from payment_attention_base as pab
    left join last_payments as lp on lp.element_id = pab.element_id
  ),
  months as (
    select generate_series(date_from_month, date_to_month, interval '1 month')::date as month_start
  ),
  monthly_trend as (
    select
      m.month_start,
      extract(year from m.month_start)::integer as year,
      extract(month from m.month_start)::integer as month,
      (
        select count(*)::integer
        from public.element_enrollments as ee
        join filtered_elements as fe on fe.id = ee.element_id
        where ee.enrolled_on >= m.month_start
          and ee.enrolled_on < (m.month_start + interval '1 month')::date
      ) as enrollments_count,
      (
        select count(*)::integer
        from public.payments as p
        join filtered_elements as fe on fe.id = p.element_id
        where p.status = 'posted'
          and p.recorded_at >= m.month_start
          and p.recorded_at < (m.month_start + interval '1 month')::date
      ) as payments_count,
      (
        select coalesce(sum(p.amount_cents), 0)::integer
        from public.payments as p
        join filtered_elements as fe on fe.id = p.element_id
        where p.status = 'posted'
          and p.recorded_at >= m.month_start
          and p.recorded_at < (m.month_start + interval '1 month')::date
      ) as payments_cents,
      (
        select count(*)::integer
        from attendance_registered as ar
        where ar.attendance_date >= m.month_start
          and ar.attendance_date < (m.month_start + interval '1 month')::date
      ) as attendance_count
    from months as m
  )
  select jsonb_build_object(
    'ok', true,
    'period', jsonb_build_object(
      'from', date_from,
      'to', date_to
    ),
    'filters', jsonb_build_object(
      'branch', branch_filter,
      'category', category_filter,
      'activity', activity_filter
    ),
    'summary', jsonb_build_object(
      'activeElements', (select count(*) from filtered_elements),
      'newEnrollments', (
        select count(*)
        from active_enrollments
        where enrolled_on between date_from and date_to
      ),
      'pendingPayments', coalesce((select sum(pending_months) from payment_attention), 0),
      'pendingAmountCents', coalesce((select sum(due_cents) from payment_attention), 0),
      'attendanceRegistered', (select count(*) from attendance_registered),
      'requiredAbsences', coalesce((select sum(absence_count) from attendance_attention), 0)
    ),
    'attendanceAttention', coalesce((
      select jsonb_agg(jsonb_build_object(
        'elementId', aa.element_id,
        'displayName', aa.display_name,
        'groupLabel', aa.group_label,
        'requiredCount', aa.required_count,
        'presentCount', aa.present_count,
        'excusedCount', aa.excused_count,
        'absenceCount', aa.absence_count
      ) order by absence_count desc, display_name)
      from (
        select *
        from attendance_attention
        where absence_count > 0
        order by absence_count desc, display_name
        limit 25
      ) as aa
    ), '[]'::jsonb),
    'paymentAttention', coalesce((
      select jsonb_agg(jsonb_build_object(
        'elementId', pa.element_id,
        'displayName', pa.display_name,
        'groupLabel', pa.group_label,
        'pendingMonths', pa.pending_months,
        'dueCents', pa.due_cents,
        'lastPaymentAt', pa.last_payment_at
      ) order by pending_months desc, due_cents desc, display_name)
      from (
        select *
        from payment_attention
        where pending_months > 0
        order by pending_months desc, due_cents desc, display_name
        limit 25
      ) as pa
    ), '[]'::jsonb),
    'monthlyTrend', coalesce((
      select jsonb_agg(jsonb_build_object(
        'year', year,
        'month', month,
        'enrollmentsCount', enrollments_count,
        'paymentsCount', payments_count,
        'paymentsCents', payments_cents,
        'attendanceCount', attendance_count
      ) order by month_start)
      from monthly_trend
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

revoke all on function public.get_operational_statistics(date, date, text, text, text) from public, anon;
grant execute on function public.get_operational_statistics(date, date, text, text, text) to authenticated, service_role;

comment on function public.get_operational_statistics(date, date, text, text, text) is
  'Returns consolidated operational statistics for elements, payments and attendance with optional branch/category/activity filters.';

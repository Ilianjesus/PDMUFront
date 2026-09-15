-- Keep failed jobs recoverable after transient n8n outages; retry on the next
-- authenticated worker run with bounded backoff instead of exhausting at 5.
begin;

drop index if exists public.element_asset_jobs_claim_idx;
create index element_asset_jobs_claim_idx on public.element_asset_jobs (next_attempt_at, created_at)
  where status in ('queued', 'failed', 'processing');

create or replace function public.claim_next_element_asset_job()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  claimed_job public.element_asset_jobs%rowtype;
  element_row public.elements%rowtype;
begin
  if not public.is_admin_operator() then
    raise exception 'ADMIN_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  select * into claimed_job
  from public.element_asset_jobs job
  where job.next_attempt_at <= now()
    and (
      job.status in ('queued', 'failed')
      or (
        job.status = 'processing'
        and job.lock_expires_at is not null
        and job.lock_expires_at <= now()
      )
    )
  order by job.created_at
  for update skip locked
  limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'job', null);
  end if;

  update public.element_asset_jobs
  set
    status = 'processing',
    attempts = attempts + 1,
    locked_at = now(),
    lock_expires_at = now() + interval '3 minutes',
    last_error_code = null,
    last_error_message = null,
    updated_at = now()
  where request_id = claimed_job.request_id
  returning * into claimed_job;

  select * into element_row
  from public.elements
  where id = claimed_job.element_id;

  return jsonb_build_object(
    'ok', true,
    'job', jsonb_build_object(
      'requestId', claimed_job.request_id,
      'elementId', claimed_job.element_id,
      'elementCode', element_row.element_code,
      'folderName', upper(btrim(concat_ws(
        ' ',
        element_row.paternal_surname,
        element_row.maternal_surname,
        element_row.given_names
      ))),
      'documents', claimed_job.documents,
      'attempts', claimed_job.attempts
    )
  );
end;
$$;

create or replace function public.fail_element_asset_job(
  p_request_id text,
  p_error_code text,
  p_error_message text
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  changed public.element_asset_jobs%rowtype;
begin
  if not public.is_admin_operator() then
    raise exception 'ADMIN_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  update public.element_asset_jobs
  set
    status = 'failed',
    next_attempt_at = now() + make_interval(secs => least(greatest(attempts, 1), 20) * 30),
    locked_at = null,
    lock_expires_at = null,
    last_error_code = left(nullif(btrim(p_error_code), ''), 80),
    last_error_message = left(nullif(btrim(p_error_message), ''), 500),
    updated_at = now()
  where request_id = btrim(p_request_id)
    and status <> 'completed'
  returning * into changed;

  if not found then
    raise exception 'ELEMENT_ASSET_JOB_NOT_FOUND' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'ok', true,
    'job', jsonb_build_object(
      'requestId', changed.request_id,
      'status', changed.status,
      'attempts', changed.attempts,
      'nextAttemptAt', changed.next_attempt_at
    )
  );
end;
$$;

revoke all on function public.claim_next_element_asset_job() from public, anon;
revoke all on function public.fail_element_asset_job(text, text, text) from public, anon;
grant execute on function public.claim_next_element_asset_job() to authenticated, service_role;
grant execute on function public.fail_element_asset_job(text, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;

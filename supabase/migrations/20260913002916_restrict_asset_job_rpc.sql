begin;

-- Existing project-level default privileges grant anon EXECUTE even after
-- revoking PUBLIC. The queue RPCs must require an authenticated admin.
revoke all on function public.queue_element_assets(text, uuid, jsonb) from public, anon;
revoke all on function public.claim_next_element_asset_job() from public, anon;
revoke all on function public.fail_element_asset_job(text, text, text) from public, anon;
grant execute on function public.queue_element_assets(text, uuid, jsonb) to authenticated, service_role;
grant execute on function public.claim_next_element_asset_job() to authenticated, service_role;
grant execute on function public.fail_element_asset_job(text, text, text) to authenticated, service_role;

commit;

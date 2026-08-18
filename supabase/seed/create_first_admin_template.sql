-- Replace REPLACE_ADMIN_EMAIL before running this template in Supabase SQL Editor.
-- The user must already exist in Supabase Auth. The placeholder intentionally fails.

do $$
declare
  admin_email constant text := 'REPLACE_ADMIN_EMAIL';
  admin_user auth.users%rowtype;
begin
  if admin_email = 'REPLACE_ADMIN_EMAIL' then
    raise exception 'Replace REPLACE_ADMIN_EMAIL before running this template';
  end if;

  select * into admin_user
  from auth.users
  where lower(email) = lower(admin_email);

  if not found then
    raise exception 'No Supabase Auth user exists for %', admin_email;
  end if;

  insert into public.operator_profiles (id, email, display_name, role, status)
  values (
    admin_user.id,
    admin_user.email,
    coalesce(admin_user.raw_user_meta_data ->> 'display_name', admin_user.email),
    'admin',
    'active'
  )
  on conflict (id) do update
  set role = 'admin', status = 'active', updated_at = now();
end
$$;

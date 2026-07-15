-- Template only. Replace all placeholders with values from an existing Supabase Auth user.
-- Run manually in Supabase SQL Editor with an appropriately privileged database role.
-- Do not commit a real user UUID or personal data into this file.

insert into public.operator_profiles (
  id,
  email,
  display_name,
  role,
  status
)
values (
  'db204134-545c-49fb-97f8-a3968d596c59',
  'ilianorduna@gmail.com',
  '-',
  'admin',
  'active'
);

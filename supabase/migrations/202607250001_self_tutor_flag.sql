alter table public.elements
add column if not exists is_self_tutor boolean not null default false;

update public.elements
set is_self_tutor = true
where status = 'active'
  and birth_date <= (current_date - interval '18 years')
  and lower(btrim(guardian_name)) = lower(btrim(concat_ws(' ', given_names, paternal_surname, maternal_surname)));

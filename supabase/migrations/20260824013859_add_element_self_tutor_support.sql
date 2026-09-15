begin;

alter table public.elements
  add column if not exists is_self_tutor boolean not null default false;

create or replace function public.enforce_self_tutor_consistency()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  full_name text;
begin
  if not new.is_self_tutor then
    return new;
  end if;

  if new.birth_date > ((current_date - interval '18 years')::date) then
    raise exception 'SELF_TUTOR_REQUIRES_ADULT' using errcode = '22023';
  end if;

  full_name := nullif(btrim(concat_ws(
    ' ',
    nullif(btrim(new.given_names), ''),
    nullif(btrim(new.paternal_surname), ''),
    nullif(btrim(new.maternal_surname), '')
  )), '');

  if full_name is null then
    raise exception 'SELF_TUTOR_REQUIRES_NAME' using errcode = '22023';
  end if;

  new.guardian_name := full_name;
  return new;
end;
$$;

create or replace function public.audit_element_profile_update()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  changed_fields text[] := array[]::text[];
begin
  if new.given_names is distinct from old.given_names then
    changed_fields := array_append(changed_fields, 'givenNames');
  end if;
  if new.paternal_surname is distinct from old.paternal_surname then
    changed_fields := array_append(changed_fields, 'paternalSurname');
  end if;
  if new.maternal_surname is distinct from old.maternal_surname then
    changed_fields := array_append(changed_fields, 'maternalSurname');
  end if;
  if new.birth_date is distinct from old.birth_date then
    changed_fields := array_append(changed_fields, 'birthDate');
  end if;
  if new.sex_code is distinct from old.sex_code then
    changed_fields := array_append(changed_fields, 'sexCode');
  end if;
  if new.group_code is distinct from old.group_code then
    changed_fields := array_append(changed_fields, 'groupCode');
  end if;
  if new.medical_notes is distinct from old.medical_notes then
    changed_fields := array_append(changed_fields, 'medicalNotes');
  end if;
  if new.guardian_name is distinct from old.guardian_name then
    changed_fields := array_append(changed_fields, 'guardianName');
  end if;
  if new.guardian_phone is distinct from old.guardian_phone then
    changed_fields := array_append(changed_fields, 'guardianPhone');
  end if;
  if new.is_self_tutor is distinct from old.is_self_tutor then
    changed_fields := array_append(changed_fields, 'isSelfTutor');
  end if;

  if cardinality(changed_fields) > 0 then
    insert into public.audit_log (
      actor_user_id,
      action,
      entity_type,
      entity_id,
      before_data,
      after_data
    ) values (
      (select auth.uid()),
      'element.profile.updated',
      'element',
      new.id::text,
      jsonb_build_object('version', old.version),
      jsonb_build_object(
        'version', new.version,
        'changedFields', to_jsonb(changed_fields),
        'isSelfTutor', new.is_self_tutor
      )
    );
  end if;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'elements_enforce_self_tutor_consistency'
      and tgrelid = 'public.elements'::regclass
  ) then
    create trigger elements_enforce_self_tutor_consistency
    before insert or update of given_names, paternal_surname, maternal_surname, birth_date, guardian_name, is_self_tutor
    on public.elements
    for each row
    execute function public.enforce_self_tutor_consistency();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'elements_audit_profile_update'
      and tgrelid = 'public.elements'::regclass
  ) then
    create trigger elements_audit_profile_update
    after update
    on public.elements
    for each row
    execute function public.audit_element_profile_update();
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

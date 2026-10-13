-- Candidate funnel step (src/lib/flow.ts). Written server-side only; middleware reads it to gate pages.

alter table profiles add column if not exists current_step text;
alter table profiles drop constraint if exists profiles_current_step_check;
alter table profiles add constraint profiles_current_step_check
  check (current_step is null or current_step in ('wizard', 'tests', 'done'));

-- Candidates may not move themselves along the funnel. Separate trigger so the existing
-- guard_profile_update() stays untouched.
create or replace function public.guard_profile_flow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_privileged_context() or public.is_super_admin() then
    return new;
  end if;
  if new.current_step is distinct from old.current_step then
    raise exception 'not allowed to change protected profile fields' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_guard_flow on profiles;
create trigger trg_profiles_guard_flow before update on profiles
  for each row execute function public.guard_profile_flow();

-- Backfill existing candidates (mirrors computeStep(): 3 tests, or all testable declared skills, min 1).
update profiles p set current_step = case
  when p.wizard_step < 4 then 'wizard'
  when (select count(*) from skill_scores s where s.profile_id = p.id)
       >= greatest(1, least(3, (
            select count(*) from claimed_skills c
            where c.profile_id = p.id
              and exists (select 1 from skills k
                          where k.is_active and (k.id = c.skill_id or lower(k.name) = lower(c.name)))
          ))) then 'done'
  else 'tests'
end
where p.role = 'candidate' and p.current_step is null;

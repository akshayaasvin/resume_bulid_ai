-- resume_build_ai: row-level security
-- Model: browser clients (anon/authenticated) only ever READ through RLS, plus a few
-- owner-scoped writes (wizard data). Anything that grades, scores, verifies PINs or
-- creates accounts runs server-side with the service_role key, which bypasses RLS.

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so policies don't recurse into profiles RLS)
-- ---------------------------------------------------------------------------
create or replace function public.app_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'super_admin' from profiles where id = auth.uid()), false)
$$;

-- College of the calling TPO (null for everyone else).
create or replace function public.tpo_college_id() returns uuid
language sql stable security definer set search_path = public as $$
  select college_id from profiles where id = auth.uid() and role = 'college_admin'
$$;

-- True for service_role and direct DB connections (migrations/seed), false for browser JWTs.
create or replace function public.is_privileged_context() returns boolean
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'postgres')
         not in ('authenticated', 'anon')
$$;

revoke execute on function public.is_privileged_context() from anon;

-- ---------------------------------------------------------------------------
-- Profiles: users may edit their own row, but never role / college / workshop / approvals.
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_privileged_context() or public.is_super_admin() then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.college_id is distinct from old.college_id
     or new.workshop_id is distinct from old.workshop_id
     or new.employer_approved is distinct from old.employer_approved
     or new.phone_whatsapp is distinct from old.phone_whatsapp
     or new.id is distinct from old.id
     or new.created_at is distinct from old.created_at then
    raise exception 'not allowed to change protected profile fields' using errcode = '42501';
  end if;
  -- opt-in timestamp is maintained here, never trusted from the client
  if new.whatsapp_opt_in and not old.whatsapp_opt_in then
    new.opt_in_at = now();
  elsif not new.whatsapp_opt_in then
    new.opt_in_at = null;
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_guard on profiles;
create trigger trg_profiles_guard before update on profiles
  for each row execute function public.guard_profile_update();

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array[
    'colleges', 'workshops', 'profiles', 'education', 'experience', 'skills', 'claimed_skills',
    'questions', 'attempts', 'attempt_answers', 'skill_scores', 'resumes', 'pin_attempts',
    'config', 'jobs', 'applications', 'notifications', 'ai_usage', 'funnel_events'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- Drop existing policies so this file is re-runnable.
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I', r.policyname, r.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- colleges: readable by signed-in users (for display); super_admin writes
-- ---------------------------------------------------------------------------
create policy colleges_read on colleges for select to authenticated using (true);
create policy colleges_admin on colleges for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

-- ---------------------------------------------------------------------------
-- workshops: secret columns are hidden at the GRANT level, not just RLS.
-- ---------------------------------------------------------------------------
revoke all on workshops from anon, authenticated;
grant select (id, college_id, batch_code, name, date, is_active, is_demo, late_grace_minutes, created_at)
  on workshops to authenticated;
create policy workshops_read_own on workshops for select to authenticated using (
  is_super_admin()
  or college_id = tpo_college_id()
  or id = (select workshop_id from profiles where id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy profiles_self_read on profiles for select to authenticated using (id = auth.uid());
create policy profiles_tpo_read on profiles for select to authenticated
  using (role = 'candidate' and college_id is not null and college_id = tpo_college_id());
create policy profiles_admin_read on profiles for select to authenticated using (is_super_admin());
create policy profiles_self_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_update on profiles for update to authenticated
  using (is_super_admin()) with check (is_super_admin());
-- no insert/delete policies: accounts are created server-side only

-- ---------------------------------------------------------------------------
-- Owner-scoped candidate data (wizard): education, experience, claimed_skills
-- ---------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['education', 'experience', 'claimed_skills'] loop
    execute format($f$create policy %1$s_owner on %1$s for all to authenticated
      using (profile_id = auth.uid()) with check (profile_id = auth.uid())$f$, t);
    execute format($f$create policy %1$s_tpo_read on %1$s for select to authenticated
      using (exists (select 1 from profiles p where p.id = %1$s.profile_id
                     and p.college_id is not null and p.college_id = tpo_college_id()))$f$, t);
    execute format($f$create policy %1$s_admin_read on %1$s for select to authenticated
      using (is_super_admin())$f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- skills: public catalogue
-- ---------------------------------------------------------------------------
create policy skills_read on skills for select to anon, authenticated using (is_active or is_super_admin());
create policy skills_admin on skills for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

-- ---------------------------------------------------------------------------
-- questions: contain answers. Super admin only; candidates get sanitized copies via the API.
-- ---------------------------------------------------------------------------
revoke all on questions from anon;
create policy questions_admin on questions for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

-- ---------------------------------------------------------------------------
-- attempts / answers / scores / resumes: read-only for owner + TPO; writes are server-only
-- ---------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['attempts', 'skill_scores', 'resumes'] loop
    execute format($f$create policy %1$s_owner_read on %1$s for select to authenticated
      using (profile_id = auth.uid())$f$, t);
    execute format($f$create policy %1$s_tpo_read on %1$s for select to authenticated
      using (exists (select 1 from profiles p where p.id = %1$s.profile_id
                     and p.college_id is not null and p.college_id = tpo_college_id()))$f$, t);
    execute format($f$create policy %1$s_admin_read on %1$s for select to authenticated
      using (is_super_admin())$f$, t);
  end loop;
end $$;

create policy attempt_answers_owner_read on attempt_answers for select to authenticated
  using (exists (select 1 from attempts a where a.id = attempt_answers.attempt_id
                 and a.profile_id = auth.uid() and a.status <> 'in_progress'));
create policy attempt_answers_admin_read on attempt_answers for select to authenticated
  using (is_super_admin());

-- ---------------------------------------------------------------------------
-- pin_attempts: lockout log. Super admin read only (proctor board reads via server).
-- ---------------------------------------------------------------------------
create policy pin_attempts_admin_read on pin_attempts for select to authenticated using (is_super_admin());

-- ---------------------------------------------------------------------------
-- config: thresholds are not secret; super_admin edits
-- ---------------------------------------------------------------------------
create policy config_read on config for select to anon, authenticated using (true);
create policy config_admin on config for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

-- ---------------------------------------------------------------------------
-- jobs / applications
-- ---------------------------------------------------------------------------
create policy jobs_open_read on jobs for select to authenticated using (status = 'open');
create policy jobs_employer_own on jobs for all to authenticated
  using (employer_id = auth.uid())
  with check (employer_id = auth.uid()
              and exists (select 1 from profiles p where p.id = auth.uid()
                          and p.role = 'employer' and p.employer_approved));
create policy jobs_admin on jobs for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

create policy applications_candidate_read on applications for select to authenticated
  using (profile_id = auth.uid());
create policy applications_employer_read on applications for select to authenticated
  using (exists (select 1 from jobs j where j.id = applications.job_id and j.employer_id = auth.uid()));
create policy applications_admin on applications for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

-- ---------------------------------------------------------------------------
-- notifications: owner reads; status changes go through the API
-- ---------------------------------------------------------------------------
create policy notifications_owner_read on notifications for select to authenticated
  using (profile_id = auth.uid() and send_after <= now());
create policy notifications_admin_read on notifications for select to authenticated using (is_super_admin());

-- ---------------------------------------------------------------------------
-- ai_usage / funnel_events: super admin only
-- ---------------------------------------------------------------------------
create policy ai_usage_admin_read on ai_usage for select to authenticated using (is_super_admin());
create policy funnel_events_admin_read on funnel_events for select to authenticated using (is_super_admin());

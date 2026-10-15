-- 1) AI-generated skill tests, cached per skill and shared by all users.
--    A generated test is an ordinary skills row (ai_generated = true) plus questions (source = 'ai'),
--    so the existing start / grade / best-score / resume pipeline handles it unchanged.

alter table skills add column if not exists ai_generated boolean not null default false;
-- one skill per name, case-insensitive ("html/css" = "HTML/CSS")
create unique index if not exists skills_name_lower_unique on skills (lower(name));

-- Generation outcome per normalised skill name. 'failed' (recently) lets candidates whose skills
-- have no test reach job matches instead of being stuck. Server-only (service role).
create table if not exists skill_test_generation (
  name_key text primary key,
  status text not null check (status in ('ready', 'failed')),
  skill_id uuid references skills(id) on delete cascade,
  attempts int not null default 0,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table skill_test_generation enable row level security;
drop policy if exists skill_test_generation_admin_read on skill_test_generation;
create policy skill_test_generation_admin_read on skill_test_generation for select to authenticated
  using (is_super_admin());

-- Atomically stores a generated test. If the skill already exists (another request won the race),
-- returns its id and inserts nothing.
create or replace function public.create_ai_skill_test(p_name text, p_slug text, p_mix jsonb, p_questions jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from skills where lower(name) = lower(p_name);
  if v_id is not null then return v_id; end if;

  insert into skills (slug, name, category, assessment_type, test_mix, is_active, ai_generated)
  values (p_slug, p_name, 'AI-generated', 'mcq', p_mix, true, true)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from skills where lower(name) = lower(p_name);
    if v_id is null then raise exception 'skill slug % already taken', p_slug; end if;
    return v_id;
  end if;

  insert into questions (skill_id, type, difficulty, body, options, correct, explanation, marks, status, source)
  select v_id, 'mcq', (q ->> 'difficulty')::smallint, q ->> 'body', q -> 'options', q -> 'correct',
         q ->> 'explanation', 1, 'published', 'ai'
  from jsonb_array_elements(p_questions) as q;
  return v_id;
end $$;
revoke execute on function public.create_ai_skill_test(text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_ai_skill_test(text, text, jsonb, jsonb) to service_role;

-- 2) Awards & certificates (wizard step 3). Same ownership rules as education.
create table if not exists awards (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 150),
  issuer text check (issuer is null or char_length(issuer) <= 150),
  year smallint check (year is null or year between 1950 and 2100),
  sort smallint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists awards_profile_idx on awards(profile_id);
alter table awards enable row level security;
drop policy if exists awards_owner on awards;
drop policy if exists awards_tpo_read on awards;
drop policy if exists awards_admin_read on awards;
create policy awards_owner on awards for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy awards_tpo_read on awards for select to authenticated
  using (exists (select 1 from profiles p where p.id = awards.profile_id
                 and p.college_id is not null and p.college_id = tpo_college_id()));
create policy awards_admin_read on awards for select to authenticated using (is_super_admin());

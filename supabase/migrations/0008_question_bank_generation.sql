-- Background question-bank generation (replaces on-demand generation while the candidate waits).
-- skill_test_generation now tracks a short lease so only one background job works on a skill at a time.

alter table skill_test_generation drop constraint if exists skill_test_generation_status_check;
alter table skill_test_generation add constraint skill_test_generation_status_check
  check (status in ('pending', 'ready', 'failed'));
alter table skill_test_generation add column if not exists started_at timestamptz;

-- Claims the generation lease for a skill. Succeeds when nobody holds it (or the holder's lease is
-- stale) and, after a failure, only once the back-off has passed. Returns true if claimed.
create or replace function public.claim_skill_generation(p_key text, p_lease_seconds int, p_failed_backoff_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  insert into skill_test_generation (name_key, status, started_at, attempts, updated_at)
  values (p_key, 'pending', now(), 1, now())
  on conflict (name_key) do update
    set status = 'pending', started_at = now(), attempts = skill_test_generation.attempts + 1, updated_at = now()
    where (skill_test_generation.status = 'ready')
       or (skill_test_generation.status = 'pending'
           and skill_test_generation.started_at < now() - make_interval(secs => p_lease_seconds))
       or (skill_test_generation.status = 'failed'
           and skill_test_generation.updated_at < now() - make_interval(secs => p_failed_backoff_seconds))
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;
revoke execute on function public.claim_skill_generation(text, int, int) from public, anon, authenticated;
grant execute on function public.claim_skill_generation(text, int, int) to service_role;

-- Creates an AI skill with its first batch (now with mcq/scenario types and 3 difficulty levels).
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

  perform public.add_ai_questions(v_id, p_questions);
  return v_id;
end $$;

-- Tops up an existing skill's bank. Question type falls back to mcq; questions are published at once
-- (source = 'ai' marks them for later review).
create or replace function public.add_ai_questions(p_skill_id uuid, p_questions jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  insert into questions (skill_id, type, difficulty, body, options, correct, explanation, marks, status, source)
  select p_skill_id,
         case when q ->> 'type' = 'scenario' then 'scenario'::question_type else 'mcq'::question_type end,
         (q ->> 'difficulty')::smallint, q ->> 'body', q -> 'options', q -> 'correct', q ->> 'explanation',
         1, 'published', 'ai'
  from jsonb_array_elements(p_questions) as q;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function public.create_ai_skill_test(text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_ai_skill_test(text, text, jsonb, jsonb) to service_role;
revoke execute on function public.add_ai_questions(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.add_ai_questions(uuid, jsonb) to service_role;

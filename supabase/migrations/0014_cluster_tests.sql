-- Cluster-based tests: one combined test per skill group, scored per skill.
-- Questions keep their single skill tag (questions.skill_id). Writes are server-side only.

create table if not exists cluster_attempts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  cluster_id text not null,
  -- [{ "skill": "SQL", "skill_id": "...", "count": 5, "question_ids": ["..."] }, ...]
  plan jsonb not null,
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted')),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  -- { "SQL": 80, "Excel": 33.33 } (per-skill score %)
  results jsonb
);
create index if not exists cluster_attempts_profile_idx on cluster_attempts(profile_id, started_at desc);

create table if not exists cluster_attempt_answers (
  attempt_id uuid not null references cluster_attempts(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade,
  seq int not null,
  answer jsonb,
  is_correct boolean not null,
  answered_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

alter table cluster_attempts enable row level security;
alter table cluster_attempt_answers enable row level security;
drop policy if exists cluster_attempts_owner_read on cluster_attempts;
drop policy if exists cluster_attempts_admin_read on cluster_attempts;
create policy cluster_attempts_owner_read on cluster_attempts for select to authenticated using (profile_id = auth.uid());
create policy cluster_attempts_admin_read on cluster_attempts for select to authenticated using (is_super_admin());
drop policy if exists cluster_attempt_answers_admin_read on cluster_attempt_answers;
-- answers (with correctness) are only read server-side, except by super admins
create policy cluster_attempt_answers_admin_read on cluster_attempt_answers for select to authenticated using (is_super_admin());

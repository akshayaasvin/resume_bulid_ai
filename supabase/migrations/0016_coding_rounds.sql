-- Optional coding round after a Programming / Data & Analytics group test (Python / SQL).
-- Kept separate from MCQ scores: it never changes skill_scores.
create table if not exists coding_rounds (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  cluster_attempt_id uuid not null references cluster_attempts(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade,
  question_ids uuid[] not null,
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted')),
  passed int,
  total int,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  unique (cluster_attempt_id, skill_id)
);
create index if not exists coding_rounds_profile_idx on coding_rounds(profile_id, created_at desc);

alter table coding_rounds enable row level security;
drop policy if exists coding_rounds_owner_read on coding_rounds;
drop policy if exists coding_rounds_admin_read on coding_rounds;
create policy coding_rounds_owner_read on coding_rounds for select to authenticated using (profile_id = auth.uid());
create policy coding_rounds_admin_read on coding_rounds for select to authenticated using (is_super_admin());

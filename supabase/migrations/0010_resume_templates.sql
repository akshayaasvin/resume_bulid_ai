-- One-page resume templates and role-tailored content.

-- Template chosen for each resume version (modern / classic / minimal / creative / tech).
alter table resumes add column if not exists template_id text
  check (template_id is null or template_id in ('modern', 'classic', 'minimal', 'creative', 'tech'));

-- Versions created when the candidate picks a target role.
alter type resume_kind add value if not exists 'tailored';

-- AI tailoring for the candidate's target role (summary, skill order, relevant projects).
-- Written server-side only; the candidate can read their own row.
create table if not exists resume_tailoring (
  profile_id uuid primary key references profiles(id) on delete cascade,
  role_id text not null,
  status text not null check (status in ('pending', 'ready', 'failed')),
  result jsonb,
  updated_at timestamptz not null default now()
);
alter table resume_tailoring enable row level security;
drop policy if exists resume_tailoring_owner_read on resume_tailoring;
drop policy if exists resume_tailoring_admin_read on resume_tailoring;
create policy resume_tailoring_owner_read on resume_tailoring for select to authenticated using (profile_id = auth.uid());
create policy resume_tailoring_admin_read on resume_tailoring for select to authenticated using (is_super_admin());

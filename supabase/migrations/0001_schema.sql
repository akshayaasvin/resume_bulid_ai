-- resume_build_ai: core schema
-- Core rule: claimed skill != verified skill. Only server-graded test scores land in skill_scores.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('candidate', 'proctor', 'college_admin', 'employer', 'super_admin');
exception when duplicate_object then null; end $$;
do $$ begin
  create type experience_type as enum ('internship', 'job', 'project');
exception when duplicate_object then null; end $$;
do $$ begin
  create type question_type as enum ('mcq', 'scenario', 'code_python', 'sql_query');
exception when duplicate_object then null; end $$;
do $$ begin
  create type question_status as enum ('draft', 'published');
exception when duplicate_object then null; end $$;
do $$ begin
  create type content_source as enum ('manual', 'ai');
exception when duplicate_object then null; end $$;
do $$ begin
  create type attempt_mode as enum ('self', 'campus');
exception when duplicate_object then null; end $$;
do $$ begin
  create type attempt_status as enum ('in_progress', 'submitted', 'expired');
exception when duplicate_object then null; end $$;
do $$ begin
  create type skill_badge as enum ('self', 'verified', 'campus_verified');
exception when duplicate_object then null; end $$;
do $$ begin
  create type skill_level as enum ('advanced', 'intermediate', 'beginner', 'needs_improvement');
exception when duplicate_object then null; end $$;
do $$ begin
  create type resume_kind as enum ('initial', 'verified');
exception when duplicate_object then null; end $$;
do $$ begin
  create type job_type as enum ('job', 'internship');
exception when duplicate_object then null; end $$;
do $$ begin
  create type job_mode as enum ('onsite', 'remote', 'hybrid');
exception when duplicate_object then null; end $$;
do $$ begin
  create type job_status as enum ('draft', 'open', 'closed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type application_status as enum ('applied', 'shortlisted', 'rejected', 'selected');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Colleges & workshops
-- ---------------------------------------------------------------------------
create table if not exists colleges (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  city text,
  created_at timestamptz not null default now()
);

create table if not exists workshops (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  batch_code text not null unique check (batch_code ~ '^[A-Z0-9-]{3,32}$'),
  name text not null,
  date date not null,
  -- secret material: never readable by anon/authenticated (column grants below)
  pin_secret text not null default encode(gen_random_bytes(32), 'hex'),
  proctor_password_hash text,
  is_active boolean not null default true,
  is_demo boolean not null default false,
  demo_pin text,                      -- fixed PIN, only honoured when is_demo = true
  late_grace_minutes int not null default 5 check (late_grace_minutes between 0 and 120),
  created_at timestamptz not null default now()
);
create index if not exists workshops_college_idx on workshops(college_id);

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'candidate',
  full_name text not null,
  name_tamil text,
  phone_whatsapp text unique check (phone_whatsapp ~ '^\+91[6-9][0-9]{9}$'),
  email text,
  college_id uuid references colleges(id) on delete set null,
  workshop_id uuid references workshops(id) on delete set null,
  department text,
  year smallint check (year between 1 and 6),
  whatsapp_opt_in boolean not null default false,
  opt_in_at timestamptz,
  language text not null default 'en' check (language in ('en', 'ta')),
  show_score_pct boolean not null default false,
  wizard_step smallint not null default 0 check (wizard_step between 0 and 4),
  summary text,
  -- Phase 3: employers / recruiter search
  company_name text,
  employer_approved boolean not null default false,
  recruiter_visible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists profiles_college_idx on profiles(college_id);
create index if not exists profiles_workshop_idx on profiles(workshop_id);

create table if not exists education (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  institution text not null,
  degree text not null,
  field text,
  start_year smallint,
  end_year smallint,
  score text,
  sort smallint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists education_profile_idx on education(profile_id);

create table if not exists experience (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  type experience_type not null,
  title text not null,
  organization text,
  start_date text,
  end_date text,
  description text,
  bullets text[] not null default '{}',
  sort smallint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists experience_profile_idx on experience(profile_id);

-- ---------------------------------------------------------------------------
-- Skills, claimed skills, questions
-- ---------------------------------------------------------------------------
create table if not exists skills (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  category text not null,
  assessment_type text not null default 'mcq' check (assessment_type in ('mcq', 'mixed')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists claimed_skills (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  skill_id uuid references skills(id) on delete set null,
  name text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists claimed_skills_unique on claimed_skills(profile_id, lower(name));

create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  external_key text unique,
  skill_id uuid not null references skills(id) on delete cascade,
  type question_type not null,
  difficulty smallint not null check (difficulty between 1 and 3),
  body text not null,
  options jsonb,          -- mcq/scenario: ["a","b","c","d"]
  correct jsonb,          -- mcq/scenario: index into options. NEVER sent to client.
  test_cases jsonb,       -- code_python: [{call, expected}], sql_query: [{expected:[[..]], ordered}]
  sql_seed text,          -- sql_query: schema + rows
  starter_code text,
  explanation text,
  marks numeric(5,2) not null default 1 check (marks > 0),
  status question_status not null default 'draft',
  source content_source not null default 'manual',
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists questions_pick_idx on questions(skill_id, status, difficulty);

-- ---------------------------------------------------------------------------
-- Attempts & scores
-- ---------------------------------------------------------------------------
create table if not exists attempts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade,
  mode attempt_mode not null default 'self',
  workshop_id uuid references workshops(id) on delete set null,
  proctor_verified boolean not null default false,
  question_ids uuid[] not null,
  tab_switches int not null default 0,
  fullscreen_exits int not null default 0,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  grace_minutes int not null default 0,
  submitted_at timestamptz,
  status attempt_status not null default 'in_progress',
  flagged boolean not null default false,
  flag_reason text,
  score_pct numeric(5,2),
  badge skill_badge,
  created_at timestamptz not null default now()
);
create index if not exists attempts_profile_idx on attempts(profile_id, skill_id);
create index if not exists attempts_workshop_idx on attempts(workshop_id, started_at desc);

create table if not exists attempt_answers (
  attempt_id uuid not null references attempts(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  answer jsonb,
  is_correct boolean,
  marks_awarded numeric(5,2),
  saved_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

create table if not exists skill_scores (
  profile_id uuid not null references profiles(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade,
  best_attempt_id uuid references attempts(id) on delete set null,
  score_pct numeric(5,2) not null,
  level skill_level not null,
  badge skill_badge not null,
  updated_at timestamptz not null default now(),
  primary key (profile_id, skill_id)
);

create table if not exists resumes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  version int not null,
  kind resume_kind not null,
  snapshot jsonb not null,
  pdf_path text,
  created_at timestamptz not null default now(),
  unique (profile_id, version)
);

create table if not exists pin_attempts (
  id bigint generated always as identity primary key,
  workshop_id uuid references workshops(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  device_id text,
  success boolean not null,
  locked boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists pin_attempts_lookup_idx on pin_attempts(profile_id, created_at desc);
create index if not exists pin_attempts_device_idx on pin_attempts(device_id, created_at desc);
create index if not exists pin_attempts_workshop_idx on pin_attempts(workshop_id, created_at desc);

create table if not exists config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Jobs, applications (Phase 3)
-- ---------------------------------------------------------------------------
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  type job_type not null default 'job',
  location text,
  mode job_mode not null default 'onsite',
  stipend_or_salary text,
  description text not null default '',
  required_skills jsonb not null default '[]',   -- [{skill_id, min_level}]
  deadline date,
  status job_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_status_idx on jobs(status, created_at desc);

create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  resume_id uuid references resumes(id) on delete set null,
  status application_status not null default 'applied',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, profile_id)
);

-- ---------------------------------------------------------------------------
-- Notifications, AI usage, funnel (Phases 2/4)
-- ---------------------------------------------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  template_key text not null,
  payload jsonb not null default '{}',
  channel text not null default 'in_app',
  send_after timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'sent', 'read', 'answered_yes', 'answered_no', 'cancelled')),
  idempotency_key text not null unique,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_due_idx on notifications(status, send_after);
create index if not exists notifications_profile_idx on notifications(profile_id, created_at desc);

create table if not exists ai_usage (
  id bigint generated always as identity primary key,
  profile_id uuid references profiles(id) on delete set null,
  feature text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  success boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_profile_idx on ai_usage(profile_id, created_at desc);

create table if not exists funnel_events (
  id bigint generated always as identity primary key,
  profile_id uuid references profiles(id) on delete cascade,
  event text not null,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists funnel_events_idx on funnel_events(event, created_at desc);
create index if not exists funnel_events_profile_idx on funnel_events(profile_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['profiles', 'questions', 'jobs', 'applications'] loop
    execute format('drop trigger if exists trg_%1$s_updated on %1$s', t);
    execute format('create trigger trg_%1$s_updated before update on %1$s for each row execute function set_updated_at()', t);
  end loop;
end $$;

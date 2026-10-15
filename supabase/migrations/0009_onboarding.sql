-- Goal-based onboarding answers and the chosen target role, plus the new 'roles' funnel step.

alter table profiles add column if not exists goal text
  check (goal is null or goal in ('job', 'internship', 'higher_studies', 'freelancing', 'not_sure'));
alter table profiles add column if not exists english_level text
  check (english_level is null or english_level in ('basic', 'intermediate', 'fluent'));
alter table profiles add column if not exists tamil_level text
  check (tamil_level is null or tamil_level in ('basic', 'intermediate', 'fluent'));
alter table profiles add column if not exists soft_skills text[] not null default '{}';
alter table profiles add column if not exists target_role_id text;
alter table profiles add column if not exists target_role text;

alter table profiles drop constraint if exists profiles_current_step_check;
alter table profiles add constraint profiles_current_step_check
  check (current_step is null or current_step in ('wizard', 'tests', 'roles', 'done'));

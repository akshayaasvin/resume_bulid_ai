-- Optional per-skill question mix, e.g. {"easy":4,"medium":5,"hard":3}. Null = global test config mix.
alter table skills add column if not exists test_mix jsonb;

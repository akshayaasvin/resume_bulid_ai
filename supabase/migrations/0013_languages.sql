-- Spoken languages besides English, in the order the candidate added them: [{"name":"Tamil","level":"fluent"}].
alter table profiles add column if not exists languages jsonb not null default '[]';

-- Existing profiles: keep their Tamil answer as the first added language (tamil_level itself is kept).
update profiles
set languages = jsonb_build_array(jsonb_build_object('name', 'Tamil', 'level', tamil_level))
where tamil_level is not null and languages = '[]'::jsonb;

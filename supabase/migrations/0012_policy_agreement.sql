-- Signup requires agreeing to the Privacy Policy and Terms (which also covers WhatsApp messages).
alter table profiles add column if not exists agreed_to_policy boolean not null default false;
alter table profiles add column if not exists agreed_at timestamptz;

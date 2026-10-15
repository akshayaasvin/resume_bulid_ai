-- WhatsApp send log: one row per message, updated on every attempt (a failed send is retried once).

create table if not exists whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  -- the test attempt that triggered the message (dedupe: one message per attempt and template)
  attempt_id uuid references attempts(id) on delete set null,
  template text not null,
  params jsonb not null default '[]',
  provider text not null check (provider in ('meta', 'aisensy', 'log')),
  status text not null check (status in ('pending', 'sent', 'failed', 'skipped')),
  provider_message_id text,
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists whatsapp_messages_attempt_template_unique
  on whatsapp_messages(attempt_id, template) where attempt_id is not null;
create index if not exists whatsapp_messages_profile_idx on whatsapp_messages(profile_id, created_at desc);

-- Written server-side only. Candidates can see their own messages; super admins all.
alter table whatsapp_messages enable row level security;
drop policy if exists whatsapp_messages_owner_read on whatsapp_messages;
drop policy if exists whatsapp_messages_admin_read on whatsapp_messages;
create policy whatsapp_messages_owner_read on whatsapp_messages for select to authenticated using (profile_id = auth.uid());
create policy whatsapp_messages_admin_read on whatsapp_messages for select to authenticated using (is_super_admin());

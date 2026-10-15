-- Group (cluster) tests in workshops: PIN (campus) mode, proctor-board visibility, tab-switch tracking.
alter table cluster_attempts add column if not exists mode attempt_mode not null default 'self';
alter table cluster_attempts add column if not exists workshop_id uuid references workshops(id) on delete set null;
alter table cluster_attempts add column if not exists proctor_verified boolean not null default false;
alter table cluster_attempts add column if not exists grace_minutes int not null default 0;
alter table cluster_attempts add column if not exists tab_switches int not null default 0;
alter table cluster_attempts add column if not exists fullscreen_exits int not null default 0;
alter table cluster_attempts add column if not exists flagged boolean not null default false;
alter table cluster_attempts add column if not exists flag_reason text;
create index if not exists cluster_attempts_workshop_idx on cluster_attempts(workshop_id, started_at desc);

-- Atomic counter bump for tab switches / fullscreen exits, auto-flagging like per-skill attempts.
create or replace function public.bump_cluster_attempt_counter(p_attempt uuid, p_kind text, p_flag_after int)
returns table (tab_switches int, fullscreen_exits int, flagged boolean)
language plpgsql security definer set search_path = public as $$
begin
  return query
  update cluster_attempts c set
    tab_switches = c.tab_switches + (case when p_kind = 'tab' then 1 else 0 end),
    fullscreen_exits = c.fullscreen_exits + (case when p_kind = 'fullscreen' then 1 else 0 end),
    flagged = c.flagged
      or (case when p_kind = 'tab' then c.tab_switches + 1 else c.tab_switches end) >= p_flag_after
      or (case when p_kind = 'fullscreen' then c.fullscreen_exits + 1 else c.fullscreen_exits end) >= p_flag_after,
    flag_reason = coalesce(c.flag_reason, case
      when (case when p_kind = 'tab' then c.tab_switches + 1 else c.tab_switches end) >= p_flag_after then 'tab_switches>=' || p_flag_after
      when (case when p_kind = 'fullscreen' then c.fullscreen_exits + 1 else c.fullscreen_exits end) >= p_flag_after then 'fullscreen_exits>=' || p_flag_after
    end)
  where c.id = p_attempt and c.status = 'in_progress'
  returning c.tab_switches, c.fullscreen_exits, c.flagged;
end $$;
revoke execute on function public.bump_cluster_attempt_counter(uuid, text, int) from public, anon, authenticated;
grant execute on function public.bump_cluster_attempt_counter(uuid, text, int) to service_role;

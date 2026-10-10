-- Atomic counter bump for tab switches / fullscreen exits, with auto-flag.
-- Service role only (called by the API after it has checked the caller owns the attempt).
create or replace function public.bump_attempt_counter(p_attempt uuid, p_kind text, p_flag_after int)
returns table (tab_switches int, fullscreen_exits int, flagged boolean)
language plpgsql security definer set search_path = public as $$
begin
  return query
  update attempts a set
    tab_switches = a.tab_switches + case when p_kind = 'tab' then 1 else 0 end,
    fullscreen_exits = a.fullscreen_exits + case when p_kind = 'fullscreen' then 1 else 0 end,
    flagged = a.flagged
      or (a.tab_switches + case when p_kind = 'tab' then 1 else 0 end) >= p_flag_after
      or (a.fullscreen_exits + case when p_kind = 'fullscreen' then 1 else 0 end) >= p_flag_after,
    flag_reason = coalesce(a.flag_reason,
      case
        when (a.tab_switches + case when p_kind = 'tab' then 1 else 0 end) >= p_flag_after then 'tab_switches>=' || p_flag_after
        when (a.fullscreen_exits + case when p_kind = 'fullscreen' then 1 else 0 end) >= p_flag_after then 'fullscreen_exits>=' || p_flag_after
      end)
  where a.id = p_attempt and a.status = 'in_progress'
  returning a.tab_switches, a.fullscreen_exits, a.flagged;
end $$;

revoke execute on function public.bump_attempt_counter(uuid, text, int) from public, anon, authenticated;
grant execute on function public.bump_attempt_counter(uuid, text, int) to service_role;

import 'server-only';
import { adminClient } from './supabase/admin';
import { getConfig } from './server-config';
import { currentPin } from './test-engine/pin';

export type StudentStatus = 'registered' | 'profile_done' | 'testing' | 'submitted';

export interface BoardStudent {
  id: string;
  name: string;
  department: string | null;
  status: StudentStatus;
  skill: string | null;
  tabSwitches: number;
  flagged: boolean;
  locked: boolean;
}

/** Live data for a workshop's proctor board. Never includes scores (the board may be on a projector). */
export async function boardData(workshopId: string) {
  const db = adminClient();
  const cfg = await getConfig('test');
  const now = new Date();

  const { data: ws } = await db
    .from('workshops').select('id, batch_code, name, date, is_demo, demo_pin, pin_secret, colleges(name)')
    .eq('id', workshopId).single();
  if (!ws) return null;

  const pin = ws.is_demo && ws.demo_pin
    ? { pin: ws.demo_pin as string, expiresAt: null as Date | null }
    : currentPin(ws.pin_secret as string, now, cfg.pinRotateMinutes);

  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const [{ data: students }, { data: attempts }, { data: pinLog }] = await Promise.all([
    db.from('profiles').select('id, full_name, department, wizard_step').eq('workshop_id', workshopId).order('created_at'),
    db.from('attempts')
      .select('profile_id, status, tab_switches, flagged, started_at, skills(name)')
      .eq('workshop_id', workshopId).gte('started_at', since).order('started_at', { ascending: false }),
    db.from('pin_attempts')
      .select('created_at, success, locked, profile_id, profiles(full_name)')
      .eq('workshop_id', workshopId).eq('success', false).gte('created_at', since)
      .order('created_at', { ascending: false }).limit(50),
  ]);

  const latestAttempt = new Map<string, { status: string; tab_switches: number; flagged: boolean; skills: { name: string } | null }>();
  for (const a of (attempts ?? []) as unknown as { profile_id: string; status: string; tab_switches: number; flagged: boolean; skills: { name: string } | null }[]) {
    if (!latestAttempt.has(a.profile_id)) latestAttempt.set(a.profile_id, a);
  }
  const lockCutoff = now.getTime() - cfg.pinLockMinutes * 60_000;
  const lockedIds = new Set(
    ((pinLog ?? []) as { locked: boolean; created_at: string; profile_id: string }[])
      .filter((p) => p.locked && new Date(p.created_at).getTime() > lockCutoff)
      .map((p) => p.profile_id),
  );

  const list: BoardStudent[] = ((students ?? []) as { id: string; full_name: string; department: string | null; wizard_step: number }[]).map((s) => {
    const a = latestAttempt.get(s.id);
    const status: StudentStatus = a ? (a.status === 'in_progress' ? 'testing' : 'submitted') : s.wizard_step >= 4 ? 'profile_done' : 'registered';
    return {
      id: s.id, name: s.full_name, department: s.department, status,
      skill: a?.skills?.name ?? null, tabSwitches: a?.tab_switches ?? 0, flagged: a?.flagged ?? false, locked: lockedIds.has(s.id),
    };
  });

  return {
    workshop: {
      batchCode: ws.batch_code as string, name: ws.name as string, date: ws.date as string,
      college: (ws.colleges as unknown as { name: string } | null)?.name ?? '', isDemo: ws.is_demo as boolean,
    },
    pin: pin.pin,
    pinExpiresAt: pin.expiresAt?.toISOString() ?? null,
    serverNow: now.toISOString(),
    students: list,
    counts: {
      registered: list.length,
      testing: list.filter((s) => s.status === 'testing').length,
      submitted: list.filter((s) => s.status === 'submitted').length,
      flagged: list.filter((s) => s.flagged).length,
    },
    pinLog: ((pinLog ?? []) as unknown as { created_at: string; locked: boolean; profiles: { full_name: string } | null }[]).map((p) => ({
      at: p.created_at, name: p.profiles?.full_name ?? '?', locked: p.locked,
    })),
  };
}

export type BoardData = NonNullable<Awaited<ReturnType<typeof boardData>>>;

import 'server-only';
import { adminClient } from './supabase/admin';
import { getConfig } from './server-config';
import { currentPin } from './test-engine/pin';
import { countByAttempt, latestByStudent, type BoardAttempt } from './proctor-merge';
import { CLUSTERS } from './tests/clusters';

export type StudentStatus = 'registered' | 'profile_done' | 'testing' | 'submitted';

export interface BoardStudent {
  id: string;
  name: string;
  department: string | null;
  status: StudentStatus;
  /** Skill (per-skill test) or group name (group test) of the latest test. */
  skill: string | null;
  kind: 'skill' | 'group' | null;
  /** Questions answered so far / in the test. */
  progress: { answered: number; total: number } | null;
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
  const [{ data: students }, { data: attempts }, { data: groupAttempts }, { data: pinLog }] = await Promise.all([
    db.from('profiles').select('id, full_name, department, wizard_step').eq('workshop_id', workshopId).order('created_at'),
    db.from('attempts')
      .select('id, profile_id, status, tab_switches, flagged, started_at, question_ids, skills(name)')
      .eq('workshop_id', workshopId).gte('started_at', since).order('started_at', { ascending: false }),
    // group (cluster) tests taken in this workshop (migration 0015); missing table/columns = none
    db.from('cluster_attempts')
      .select('id, profile_id, status, tab_switches, flagged, started_at, cluster_id, plan')
      .eq('workshop_id', workshopId).gte('started_at', since).order('started_at', { ascending: false }),
    db.from('pin_attempts')
      .select('created_at, success, locked, profile_id, profiles(full_name)')
      .eq('workshop_id', workshopId).eq('success', false).gte('created_at', since)
      .order('created_at', { ascending: false }).limit(50),
  ]);

  type SkillRow = { id: string; profile_id: string; status: BoardAttempt['status']; tab_switches: number; flagged: boolean; started_at: string; question_ids: string[]; skills: { name: string } | null };
  type GroupRow = { id: string; profile_id: string; status: 'in_progress' | 'submitted'; tab_switches: number; flagged: boolean; started_at: string; cluster_id: string; plan: { count: number }[] };
  const skillRows = (attempts ?? []) as unknown as SkillRow[];
  const groupRows = (groupAttempts ?? []) as unknown as GroupRow[];
  // Progress for tests still running: answers saved so far.
  const openSkill = skillRows.filter((a) => a.status === 'in_progress').map((a) => a.id);
  const openGroup = groupRows.filter((a) => a.status === 'in_progress').map((a) => a.id);
  const [{ data: skillAnswers }, { data: groupAnswers }] = await Promise.all([
    openSkill.length ? db.from('attempt_answers').select('attempt_id').in('attempt_id', openSkill) : Promise.resolve({ data: [] }),
    openGroup.length ? db.from('cluster_attempt_answers').select('attempt_id').in('attempt_id', openGroup) : Promise.resolve({ data: [] }),
  ]);
  const answered = countByAttempt([...(skillAnswers ?? []), ...(groupAnswers ?? [])] as { attempt_id: string }[]);
  const latestAttempt = latestByStudent([
    ...skillRows.map((a): BoardAttempt => ({
      profileId: a.profile_id, label: a.skills?.name ?? '?', kind: 'skill', status: a.status, startedAt: a.started_at,
      tabSwitches: a.tab_switches, flagged: a.flagged, total: a.question_ids?.length ?? 0,
      answered: a.status === 'in_progress' ? answered.get(a.id) ?? 0 : a.question_ids?.length ?? 0,
    })),
    ...groupRows.map((a): BoardAttempt => {
      const total = (a.plan ?? []).reduce((n, p) => n + (p.count ?? 0), 0);
      return {
        profileId: a.profile_id, label: CLUSTERS.find((c) => c.id === a.cluster_id)?.label ?? a.cluster_id, kind: 'group',
        status: a.status, startedAt: a.started_at, tabSwitches: a.tab_switches ?? 0, flagged: !!a.flagged, total,
        answered: a.status === 'in_progress' ? answered.get(a.id) ?? 0 : total,
      };
    }),
  ]);
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
      skill: a?.label ?? null, kind: a?.kind ?? null, progress: a ? { answered: a.answered, total: a.total } : null,
      tabSwitches: a?.tabSwitches ?? 0, flagged: a?.flagged ?? false, locked: lockedIds.has(s.id),
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

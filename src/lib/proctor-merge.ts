/** Pure helpers for the proctor board: per-skill attempts and group (cluster) attempts side by side. */

export interface BoardAttempt {
  profileId: string;
  /** Skill name (per-skill test) or group name (group test). */
  label: string;
  kind: 'skill' | 'group';
  status: 'in_progress' | 'submitted' | 'expired';
  startedAt: string;
  tabSwitches: number;
  flagged: boolean;
  answered: number;
  total: number;
}

/** Each student's most recent test of either kind. */
export function latestByStudent(attempts: BoardAttempt[]): Map<string, BoardAttempt> {
  const out = new Map<string, BoardAttempt>();
  for (const a of attempts) {
    const cur = out.get(a.profileId);
    if (!cur || new Date(a.startedAt).getTime() > new Date(cur.startedAt).getTime()) out.set(a.profileId, a);
  }
  return out;
}

/** Answers saved per attempt id, from rows of { attempt_id }. */
export function countByAttempt(rows: { attempt_id: string }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.attempt_id, (out.get(r.attempt_id) ?? 0) + 1);
  return out;
}

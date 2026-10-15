import { describe, expect, it } from 'vitest';
import { countByAttempt, latestByStudent, type BoardAttempt } from '@/lib/proctor-merge';

const a = (o: Partial<BoardAttempt>): BoardAttempt => ({
  profileId: 'p1', label: 'Excel', kind: 'skill', status: 'submitted', startedAt: '2026-10-16T09:00:00Z',
  tabSwitches: 0, flagged: false, answered: 15, total: 15, ...o,
});

describe('proctor board merge', () => {
  it("shows each student's latest test, per-skill or group", () => {
    const m = latestByStudent([
      a({ profileId: 'p1', label: 'Excel', startedAt: '2026-10-16T09:00:00Z' }),
      a({ profileId: 'p1', label: 'Data & Analytics', kind: 'group', status: 'in_progress', startedAt: '2026-10-16T09:30:00Z', answered: 4 }),
      a({ profileId: 'p2', label: 'Programming', kind: 'group', startedAt: '2026-10-16T08:00:00Z' }),
      a({ profileId: 'p2', label: 'Python', startedAt: '2026-10-16T09:10:00Z' }),
    ]);
    expect(m.get('p1')).toMatchObject({ label: 'Data & Analytics', kind: 'group', status: 'in_progress', answered: 4 });
    expect(m.get('p2')).toMatchObject({ label: 'Python', kind: 'skill' });
  });
  it('counts saved answers per attempt for progress', () => {
    const c = countByAttempt([{ attempt_id: 'x' }, { attempt_id: 'y' }, { attempt_id: 'x' }]);
    expect(c.get('x')).toBe(2);
    expect(c.get('y')).toBe(1);
    expect(c.get('z')).toBeUndefined();
  });
});

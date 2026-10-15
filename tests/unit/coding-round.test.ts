import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = {
    tables: {} as Record<string, Row[]>,
    touched: new Set<string>(),
    updates: [] as { table: string; patch: Row }[],
  };
  const builder = (table: string) => {
    state.touched.add(table);
    const filters: [string, unknown][] = [];
    const rows = () => (state.tables[table] ?? []).filter((r) => filters.every(([k, v]) =>
      Array.isArray(v) ? v.includes(r[k]) : r[k] === v));
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (k: string, v: unknown) => { filters.push([k, v]); return b; };
    b.in = (k: string, v: unknown[]) => { filters.push([k, v]); return b; };
    b.maybeSingle = async () => ({ data: rows()[0] ?? null });
    b.single = async () => ({ data: rows()[0] ?? null, error: null });
    b.then = (res: (v: unknown) => unknown) => res({ data: rows() });
    b.insert = (row: Row) => {
      const saved = { id: `r-${(state.tables[table] ?? []).length + 1}`, status: 'in_progress', ...row };
      state.tables[table] = [...(state.tables[table] ?? []), saved];
      return { select: () => ({ single: async () => ({ data: saved, error: null }) }) };
    };
    b.update = (patch: Row) => {
      state.updates.push({ table, patch });
      const u = { eq: () => u, then: (res: (v: unknown) => unknown) => {
        for (const r of state.tables[table] ?? []) Object.assign(r, patch);
        return res({ error: null });
      } };
      return u;
    };
    return b;
  };
  return { db: { state, from: builder } };
});

vi.mock('@/lib/supabase/admin', () => ({ adminClient: () => db }));
vi.mock('@/lib/test-engine/sql-runner', () => ({ runSqlOnServer: async () => [] }));

import { codingOffer, startCodingRound, submitCodingRound } from '@/lib/tests/coding-round';

const plan = [
  { skill: 'Python', skill_id: 's-py', count: 8, question_ids: [] },
  { skill: 'Java', skill_id: 's-java', count: 7, question_ids: [] },
];
const attempt = { id: 'ca-1', profile_id: 'p-1', cluster_id: 'programming', status: 'submitted', plan };

beforeEach(() => {
  db.state.tables = {
    cluster_attempts: [{ ...attempt }],
    skills: [{ id: 's-py', slug: 'python' }, { id: 's-java', slug: 'java' }],
    coding_rounds: [],
    questions: [
      { id: 'q1', skill_id: 's-py', type: 'code_python', status: 'published', marks: 2, test_cases: [{ call: 'f(1)', expected: '2' }] },
      { id: 'q2', skill_id: 's-py', type: 'code_python', status: 'published', marks: 2, test_cases: [{ call: 'f(2)', expected: '4' }] },
      { id: 'q3', skill_id: 's-py', type: 'mcq', status: 'published', marks: 1, options: ['a', 'b'], correct: 0 },
    ],
  };
  db.state.touched.clear();
  db.state.updates = [];
});

describe('coding round', () => {
  it('is offered only for Python / SQL after a finished Programming or Data group test', async () => {
    expect(await codingOffer(attempt)).toEqual([{ skill: 'Python', skillId: 's-py', result: null }]);
    expect(await codingOffer({ ...attempt, status: 'in_progress' })).toEqual([]);
    expect(await codingOffer({ ...attempt, cluster_id: 'cloud' })).toEqual([]);
  });

  it('serves 2 coding questions without answers', async () => {
    const r = await startCodingRound('p-1', 'ca-1', 's-py');
    expect(r.questions).toHaveLength(2);
    expect(r.questions.every((q) => q.type === 'code_python')).toBe(true);
    expect(JSON.stringify(r.questions)).not.toContain('expected');
    await expect(startCodingRound('p-1', 'ca-1', 's-java')).rejects.toMatchObject({ code: 'not_offered' });
    await expect(startCodingRound('someone-else', 'ca-1', 's-py')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('grades with the existing grader and never touches the MCQ skill score', async () => {
    const r = await startCodingRound('p-1', 'ca-1', 's-py');
    const right = (q: string) => ({ code: 'x', outputs: [q === 'q1' ? '2' : '4'] });
    const result = await submitCodingRound('p-1', r.roundId, { q1: right('q1'), q2: { code: 'x', outputs: ['wrong'] } });
    expect(result).toEqual({ passed: 1, total: 2, verified: true }); // 50% = verified (resume threshold)
    expect(db.state.touched.has('skill_scores')).toBe(false);
    // submitting again returns the stored result
    expect(await submitCodingRound('p-1', r.roundId, {})).toEqual({ passed: 1, total: 2, verified: true });
  });

  it('0 of 2 is not coding verified', async () => {
    const r = await startCodingRound('p-1', 'ca-1', 's-py');
    expect(await submitCodingRound('p-1', r.roundId, {})).toEqual({ passed: 0, total: 2, verified: false });
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_TEST } from '@/lib/config';
import { hashSeed, isCoding, mulberry32, pickQuestions, sanitizeQuestion, type QuestionRow, type QuestionType } from '@/lib/test-engine/questions';

function pool(spec: { d: 1 | 2 | 3; type: QuestionType; n: number }[]) {
  let i = 0;
  return spec.flatMap(({ d, type, n }) => Array.from({ length: n }, () => ({ id: `q${i++}`, difficulty: d, type })));
}

// Same shape as the seed: 10/12/8 with a handful of coding questions in each bucket.
const seedLike = pool([
  { d: 1, type: 'mcq', n: 9 }, { d: 1, type: 'code_python', n: 1 },
  { d: 2, type: 'mcq', n: 10 }, { d: 2, type: 'code_python', n: 2 },
  { d: 3, type: 'mcq', n: 6 }, { d: 3, type: 'code_python', n: 2 },
]);

describe('pickQuestions', () => {
  it('picks 15 = 5 easy / 7 medium / 3 hard', () => {
    for (let seed = 0; seed < 200; seed++) {
      const qs = pickQuestions(seedLike, DEFAULT_TEST, mulberry32(seed));
      expect(qs).toHaveLength(15);
      expect(qs.filter((q) => q.difficulty === 1)).toHaveLength(5);
      expect(qs.filter((q) => q.difficulty === 2)).toHaveLength(7);
      expect(qs.filter((q) => q.difficulty === 3)).toHaveLength(3);
      expect(new Set(qs.map((q) => q.id)).size).toBe(15);
    }
  });

  it('never includes more than 2 coding questions', () => {
    const codingHeavy = pool([
      { d: 1, type: 'code_python', n: 8 }, { d: 1, type: 'mcq', n: 5 },
      { d: 2, type: 'sql_query', n: 10 }, { d: 2, type: 'mcq', n: 7 },
      { d: 3, type: 'code_python', n: 6 }, { d: 3, type: 'mcq', n: 3 },
    ]);
    for (let seed = 0; seed < 200; seed++) {
      const qs = pickQuestions(codingHeavy, DEFAULT_TEST, mulberry32(seed));
      expect(qs.filter((q) => isCoding(q.type)).length).toBeLessThanOrEqual(2);
      expect(qs).toHaveLength(15);
    }
  });

  it('backfills from other difficulties when a bucket is short', () => {
    const short = pool([{ d: 1, type: 'mcq', n: 10 }, { d: 2, type: 'mcq', n: 3 }, { d: 3, type: 'mcq', n: 5 }]);
    const qs = pickQuestions(short, DEFAULT_TEST, mulberry32(1));
    expect(qs).toHaveLength(15);
    expect(qs.filter((q) => q.difficulty === 2)).toHaveLength(3);
  });

  it('returns what exists when the pool is tiny', () => {
    expect(pickQuestions(pool([{ d: 1, type: 'mcq', n: 4 }]), DEFAULT_TEST, mulberry32(1))).toHaveLength(4);
    expect(pickQuestions([], DEFAULT_TEST, mulberry32(1))).toHaveLength(0);
  });

  it('orders by difficulty', () => {
    const qs = pickQuestions(seedLike, DEFAULT_TEST, mulberry32(7));
    const diffs = qs.map((q) => q.difficulty);
    expect(diffs).toEqual([...diffs].sort());
  });
});

describe('sanitizeQuestion (no secrets reach the browser)', () => {
  const full: QuestionRow = {
    id: 'q1', skill_id: 's1', type: 'mcq', difficulty: 2, body: 'Pick one', options: ['w', 'x', 'y', 'z'], correct: 3,
    test_cases: null, sql_seed: null, starter_code: null, explanation: 'Because z', marks: 1,
  };
  const py: QuestionRow = {
    ...full, id: 'q2', type: 'code_python', options: null, correct: null, explanation: 'secret explanation',
    test_cases: [{ call: 'f(1)', expected: 'SECRET_EXPECTED_42' }], starter_code: 'def f(x):\n    pass',
  };
  const sql: QuestionRow = {
    ...full, id: 'q3', type: 'sql_query', options: null, correct: null,
    test_cases: [{ expected: [['SECRET_ROW']], ordered: true }], sql_seed: 'CREATE TABLE t(a);',
  };

  it('strips correct answer, explanation and expected outputs', () => {
    for (const q of [full, py, sql]) {
      const out = sanitizeQuestion(q, 'attempt-1');
      const json = JSON.stringify(out);
      expect(out).not.toHaveProperty('correct');
      expect(out).not.toHaveProperty('explanation');
      expect(out).not.toHaveProperty('test_cases');
      expect(json).not.toContain('SECRET');
      expect(json).not.toContain('Because z');
      expect(json).not.toContain('secret explanation');
    }
  });

  it('keeps what the candidate needs', () => {
    const p = sanitizeQuestion(py, 'a');
    expect(p.calls).toEqual(['f(1)']);
    expect(p.starterCode).toContain('def f');
    expect(sanitizeQuestion(sql, 'a').sqlSeed).toContain('CREATE TABLE');
  });

  it('shuffles options per attempt, deterministically, keeping original keys', () => {
    const a1 = sanitizeQuestion(full, 'attempt-1').options!;
    const a1again = sanitizeQuestion(full, 'attempt-1').options!;
    expect(a1).toEqual(a1again);
    expect(a1.map((o) => o.key).sort()).toEqual([0, 1, 2, 3]);
    for (const o of a1) expect(full.options![o.key]).toBe(o.text);
    const orders = new Set(Array.from({ length: 30 }, (_, i) => sanitizeQuestion(full, `att-${i}`).options!.map((o) => o.key).join('')));
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe('rng helpers', () => {
  it('hashSeed is stable', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
  });
});

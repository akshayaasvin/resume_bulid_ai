import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain ESM helper shared with scripts/db.mjs
import { loadSeed, validateSeed } from '../../scripts/seed-data.mjs';
import { gradeAnswer } from '@/lib/test-engine/grading';
import { sanitizeQuestion, type QuestionRow } from '@/lib/test-engine/questions';
import { runSql } from './sqljs';

const seed = loadSeed();

// Reference solutions: prove each seeded SQL question's expected rows are actually right.
const SQL_REFERENCE: Record<string, string> = {
  'sql-e10': "SELECT name FROM students WHERE dept = 'CSE' ORDER BY name",
  'sql-m11': 'SELECT dept, COUNT(*) AS total FROM students GROUP BY dept ORDER BY dept',
  'sql-m12': 'SELECT name, marks FROM students WHERE marks > 80 ORDER BY marks DESC',
  'sql-h07': 'SELECT c.name, SUM(o.amount) AS total_amount FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.id ORDER BY total_amount DESC',
  'sql-h08': 'SELECT c.name FROM customers c LEFT JOIN orders o ON o.customer_id = c.id WHERE o.id IS NULL',
};

type SeedQ = { key: string; type: QuestionRow['type']; difficulty: 1 | 2 | 3; body: string; options?: string[]; correct?: number;
  test_cases?: unknown; sql_seed: string | null; starter_code?: string; explanation?: string; marks: number };

const asRow = (q: SeedQ): QuestionRow => ({
  id: q.key, skill_id: 's', type: q.type, difficulty: q.difficulty, body: q.body, options: q.options ?? null,
  correct: q.correct ?? null, test_cases: (q.test_cases as QuestionRow['test_cases']) ?? null, sql_seed: q.sql_seed,
  starter_code: q.starter_code ?? null, explanation: q.explanation ?? null, marks: q.marks,
});

describe('seed question bank', () => {
  it('has 5 skills x 30 questions (10/12/8) and is valid', () => {
    expect(seed.skills.map((s: { slug: string }) => s.slug)).toEqual(['python', 'sql', 'excel', 'communication', 'digital-marketing']);
    expect(validateSeed(seed)).toEqual([]);
  });

  const sqlQs: SeedQ[] = seed.skills.flatMap((s: { questions: SeedQ[] }) => s.questions).filter((q: SeedQ) => q.type === 'sql_query');
  it('every SQL question has a reference solution', () => {
    expect(sqlQs.map((q) => q.key).sort()).toEqual(Object.keys(SQL_REFERENCE).sort());
  });
  it.each(Object.entries(SQL_REFERENCE))('%s reference solution earns full marks', async (key, ref) => {
    const q = sqlQs.find((x) => x.key === key)!;
    const r = await gradeAnswer(asRow(q), { sql: ref }, runSql);
    expect(r.isCorrect).toBe(true);
  });

  it('no seeded question leaks its answer after sanitizing', () => {
    for (const s of seed.skills as { questions: SeedQ[] }[]) {
      for (const q of s.questions) {
        const json = JSON.stringify(sanitizeQuestion(asRow(q), 'att'));
        expect(json).not.toContain('"correct"');
        expect(json).not.toContain('"expected"');
        expect(json).not.toContain('"explanation"');
      }
    }
  });
});

import { z } from 'zod';
import type { PythonCase, QuestionRow, SqlCase } from './questions';

export const NUMERIC_TOLERANCE = 0.01;

export const answerSchema = z.union([
  z.object({ choice: z.number().int().min(0).max(20) }),
  z.object({ code: z.string().max(10_000), outputs: z.array(z.string().max(5_000).nullable()).max(20) }),
  z.object({ sql: z.string().max(2_000) }),
]);
export type Answer = z.infer<typeof answerSchema>;

export type SqlRunner = (seed: string, query: string) => Promise<unknown[][]>;

export interface GradeResult {
  isCorrect: boolean;
  marks: number;
}

const NUM_RE = /-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi;

function normalize(s: string): string {
  return s.replace(/\r\n/g, '\n').trim().replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n');
}

/**
 * Output comparison: exact after whitespace normalisation, or same text skeleton with every
 * number within ±0.01 (so "3.3333" matches "3.33", "[1.0, 2]" matches "[1, 2.0]").
 */
export function outputsMatch(actual: string | null | undefined, expected: string): boolean {
  if (actual == null) return false;
  const a = normalize(actual);
  const e = normalize(expected);
  if (a === e) return true;
  const aNums = a.match(NUM_RE) ?? [];
  const eNums = e.match(NUM_RE) ?? [];
  if (aNums.length === 0 || aNums.length !== eNums.length) return false;
  if (a.replace(NUM_RE, '#') !== e.replace(NUM_RE, '#')) return false;
  return aNums.every((n, i) => Math.abs(Number(n) - Number(eNums[i])) <= NUMERIC_TOLERANCE + 1e-9);
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  return String(v);
}

export function rowsMatch(actual: unknown[][], expected: unknown[][], ordered: boolean): boolean {
  if (actual.length !== expected.length) return false;
  const toKey = (r: unknown[]) => r.map(cellToString).join('\u0001');
  const a = actual.map((r) => r.map(cellToString));
  const e = expected.map((r) => r.map(cellToString));
  if (!ordered) {
    a.sort((x, y) => toKey(x).localeCompare(toKey(y)));
    e.sort((x, y) => toKey(x).localeCompare(toKey(y)));
  }
  return a.every((row, i) => row.length === e[i].length && row.every((c, j) => outputsMatch(c, e[i][j])));
}

/** Only a single read-only SELECT/WITH statement, no recursion (keeps server grading bounded). */
export function validateSqlQuery(sql: string): string | null {
  const q = sql.trim().replace(/;\s*$/, '');
  if (!q) return 'empty query';
  if (q.length > 2000) return 'query too long';
  if (q.includes(';')) return 'only one statement allowed';
  if (!/^(select|with)\b/i.test(q)) return 'only SELECT queries are allowed';
  if (/\brecursive\b/i.test(q)) return 'recursive queries are not allowed';
  if (/\b(attach|pragma|insert|update|delete|drop|create|alter|replace|vacuum)\b/i.test(q)) {
    return 'only SELECT queries are allowed';
  }
  return null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function gradeAnswer(q: QuestionRow, answer: Answer | null | undefined, runSql: SqlRunner): Promise<GradeResult> {
  const zero = { isCorrect: false, marks: 0 };
  const marks = Number(q.marks);
  if (!answer) return zero;

  switch (q.type) {
    case 'mcq':
    case 'scenario': {
      if (!('choice' in answer) || q.correct == null) return zero;
      const ok = answer.choice === Number(q.correct);
      return { isCorrect: ok, marks: ok ? marks : 0 };
    }
    case 'code_python': {
      if (!('outputs' in answer)) return zero;
      const cases = (q.test_cases ?? []) as PythonCase[];
      if (cases.length === 0) return zero;
      const passed = cases.filter((c, i) => outputsMatch(answer.outputs[i], c.expected)).length;
      return { isCorrect: passed === cases.length, marks: round2((marks * passed) / cases.length) };
    }
    case 'sql_query': {
      if (!('sql' in answer)) return zero;
      if (validateSqlQuery(answer.sql)) return zero;
      const cases = (q.test_cases ?? []) as SqlCase[];
      if (cases.length === 0 || !q.sql_seed) return zero;
      let rows: unknown[][];
      try {
        rows = await runSql(q.sql_seed, answer.sql.trim().replace(/;\s*$/, ''));
      } catch {
        return zero;
      }
      const ok = cases.every((c) => rowsMatch(rows, c.expected, c.ordered ?? false));
      return { isCorrect: ok, marks: ok ? marks : 0 };
    }
    default:
      return zero;
  }
}

export function scorePct(results: GradeResult[], questions: Pick<QuestionRow, 'marks'>[]): number {
  const total = questions.reduce((s, q) => s + Number(q.marks), 0);
  if (total <= 0) return 0;
  const got = results.reduce((s, r) => s + r.marks, 0);
  return round2((got / total) * 100);
}

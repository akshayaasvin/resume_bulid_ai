import { describe, expect, it } from 'vitest';
import { gradeAnswer, outputsMatch, rowsMatch, scorePct, validateSqlQuery } from '@/lib/test-engine/grading';
import type { QuestionRow } from '@/lib/test-engine/questions';
import { runSql } from './sqljs';

const mcq: QuestionRow = {
  id: 'q1', skill_id: 's', type: 'mcq', difficulty: 1, body: 'b', options: ['a', 'b', 'c', 'd'], correct: 2,
  test_cases: null, sql_seed: null, starter_code: null, marks: 1,
};
const scenario: QuestionRow = { ...mcq, id: 'q2', type: 'scenario', correct: 0 };
const py: QuestionRow = {
  ...mcq, id: 'q3', type: 'code_python', options: null, correct: null, marks: 2,
  test_cases: [{ call: 'f(1)', expected: '2' }, { call: 'f(2)', expected: '4' }, { call: 'g()', expected: '3.3333' }, { call: 'h()', expected: "'ok'" }],
};
const SEED = "CREATE TABLE t (id INTEGER, name TEXT, v REAL); INSERT INTO t VALUES (1,'a',1.5),(2,'b',2.25),(3,'c',NULL);";
const sql: QuestionRow = {
  ...mcq, id: 'q4', type: 'sql_query', options: null, correct: null, marks: 3, sql_seed: SEED,
  test_cases: [{ expected: [['a', 1.5], ['b', 2.25]], ordered: true }],
};
const sqlUnordered: QuestionRow = { ...sql, id: 'q5', test_cases: [{ expected: [['b'], ['a']], ordered: false }] };

describe('outputsMatch', () => {
  it('exact and whitespace-normalised', () => {
    expect(outputsMatch('hello', 'hello')).toBe(true);
    expect(outputsMatch('  a  b \n', 'a b')).toBe(true);
    expect(outputsMatch('hello', 'Hello')).toBe(false);
  });
  it('numeric tolerance ±0.01', () => {
    expect(outputsMatch('3.333', '3.33')).toBe(true);
    expect(outputsMatch('3.34', '3.33')).toBe(true);
    expect(outputsMatch('3.35', '3.33')).toBe(false);
    expect(outputsMatch('[1.0, 2]', '[1, 2.0]')).toBe(true);
    expect(outputsMatch('Total: 10.004', 'Total: 10')).toBe(true);
    expect(outputsMatch('Total: 10', 'Sum: 10')).toBe(false);
  });
  it('null output never matches', () => {
    expect(outputsMatch(null, '1')).toBe(false);
  });
});

describe('gradeAnswer', () => {
  it('mcq correct / wrong / missing', async () => {
    expect(await gradeAnswer(mcq, { choice: 2 }, runSql)).toEqual({ isCorrect: true, marks: 1 });
    expect(await gradeAnswer(mcq, { choice: 1 }, runSql)).toEqual({ isCorrect: false, marks: 0 });
    expect(await gradeAnswer(mcq, null, runSql)).toEqual({ isCorrect: false, marks: 0 });
  });
  it('scenario graded like mcq', async () => {
    expect((await gradeAnswer(scenario, { choice: 0 }, runSql)).isCorrect).toBe(true);
  });
  it('wrong answer shape scores zero', async () => {
    expect((await gradeAnswer(mcq, { sql: 'select 1' }, runSql)).marks).toBe(0);
  });
  it('python: all cases pass -> full marks', async () => {
    const r = await gradeAnswer(py, { code: 'x', outputs: ['2', '4', '3.33', "'ok'"] }, runSql);
    expect(r).toEqual({ isCorrect: true, marks: 2 });
  });
  it('python: partial credit per passing case', async () => {
    const r = await gradeAnswer(py, { code: 'x', outputs: ['2', '5', null, "'ok'"] }, runSql);
    expect(r).toEqual({ isCorrect: false, marks: 1 });
  });
  it('sql: re-runs the query on the server and compares rows', async () => {
    expect(await gradeAnswer(sql, { sql: 'SELECT name, v FROM t WHERE v IS NOT NULL ORDER BY id' }, runSql))
      .toEqual({ isCorrect: true, marks: 3 });
    expect((await gradeAnswer(sql, { sql: 'SELECT name, v FROM t ORDER BY id' }, runSql)).isCorrect).toBe(false);
    expect((await gradeAnswer(sql, { sql: 'SELECT name, v FROM t WHERE v IS NOT NULL ORDER BY id DESC' }, runSql)).isCorrect).toBe(false);
  });
  it('sql: unordered comparison ignores row order', async () => {
    expect((await gradeAnswer(sqlUnordered, { sql: "SELECT name FROM t WHERE name IN ('a','b') ORDER BY name" }, runSql)).isCorrect).toBe(true);
  });
  it('sql: syntax errors and forbidden statements score zero', async () => {
    expect((await gradeAnswer(sql, { sql: 'SELEC name FROM t' }, runSql)).marks).toBe(0);
    expect((await gradeAnswer(sql, { sql: 'DROP TABLE t' }, runSql)).marks).toBe(0);
  });
});

describe('validateSqlQuery', () => {
  it('allows a single SELECT/WITH', () => {
    expect(validateSqlQuery('SELECT 1')).toBeNull();
    expect(validateSqlQuery('select 1;')).toBeNull();
    expect(validateSqlQuery('WITH x AS (SELECT 1) SELECT * FROM x')).toBeNull();
  });
  it('rejects writes, multiple statements and recursion', () => {
    expect(validateSqlQuery('DELETE FROM t')).not.toBeNull();
    expect(validateSqlQuery('SELECT 1; SELECT 2')).not.toBeNull();
    expect(validateSqlQuery('WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r) SELECT * FROM r')).not.toBeNull();
    expect(validateSqlQuery('SELECT 1 FROM t; DROP TABLE t')).not.toBeNull();
    expect(validateSqlQuery('')).not.toBeNull();
  });
});

describe('rowsMatch', () => {
  it('treats NULL explicitly', () => {
    expect(rowsMatch([[null]], [[null]], true)).toBe(true);
    expect(rowsMatch([[null]], [['NULL']], true)).toBe(true);
    expect(rowsMatch([[0]], [[null]], true)).toBe(false);
  });
});

describe('scorePct', () => {
  it('weights by marks', () => {
    expect(scorePct([{ isCorrect: true, marks: 1 }, { isCorrect: false, marks: 0 }, { isCorrect: true, marks: 2 }],
      [{ marks: 1 }, { marks: 1 }, { marks: 2 }])).toBe(75);
  });
  it('handles empty', () => {
    expect(scorePct([], [])).toBe(0);
  });
});

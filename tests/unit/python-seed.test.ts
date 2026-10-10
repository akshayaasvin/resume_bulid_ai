import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPyodide, type PyodideInterface } from 'pyodide';
// @ts-expect-error - plain ESM helper shared with scripts/db.mjs
import { loadSeed } from '../../scripts/seed-data.mjs';
import { gradeAnswer } from '@/lib/test-engine/grading';
import type { QuestionRow } from '@/lib/test-engine/questions';
import { runSql } from './sqljs';

/**
 * Runs the exact harness from public/workers/py-worker.js under Pyodide in Node, so the
 * candidate's runtime and the expected outputs in the seed are checked against each other.
 */
const workerSrc = readFileSync(path.join(process.cwd(), 'public', 'workers', 'py-worker.js'), 'utf8');
const HARNESS = workerSrc.match(/const HARNESS = `([\s\S]*?)`;/)![1];

const REFERENCE: Record<string, string> = {
  'py-e10': 'def square(n):\n    return n * n\n',
  'py-m11': "def count_vowels(s):\n    return sum(1 for c in s.lower() if c in 'aeiou')\n",
  'py-m12': 'def second_largest(nums):\n    return sorted(set(nums))[-2]\n',
  'py-h07': 'def is_palindrome(s):\n    t = [c.lower() for c in s if c.isalnum()]\n    return t == t[::-1]\n',
  'py-h08': [
    'from collections import Counter',
    'def top_words(text, k):',
    '    c = Counter(text.lower().split())',
    '    return sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[:k]',
  ].join('\n'),
};

let py: PyodideInterface;

async function run(code: string, calls: string[]) {
  py.globals.set('__rb_code', code);
  py.globals.set('__rb_calls', py.toPy(calls));
  return JSON.parse(py.runPython(HARNESS)) as { stdout: string; outputs: (string | null)[]; error: string | null };
}

beforeAll(async () => {
  py = await loadPyodide({ indexURL: path.join(process.cwd(), 'node_modules', 'pyodide') });
  py.runPython('import builtins\ndef _b(*a, **k):\n    raise RuntimeError("input() is not available in tests.")\nbuiltins.input = _b');
}, 120_000);

const seed = loadSeed();
type SeedQ = { key: string; type: string; test_cases: { call: string; expected: string }[]; marks: number; starter_code?: string };
const pyQs: SeedQ[] = seed.skills.find((s: { slug: string }) => s.slug === 'python').questions.filter((q: SeedQ) => q.type === 'code_python');

const asRow = (q: SeedQ) => ({
  id: q.key, skill_id: 's', type: 'code_python', difficulty: 1, body: '', options: null, correct: null,
  test_cases: q.test_cases, sql_seed: null, starter_code: null, marks: q.marks,
}) as QuestionRow;

describe('python seed questions (via the browser harness)', () => {
  it('every coding question has a reference solution', () => {
    expect(pyQs.map((q) => q.key).sort()).toEqual(Object.keys(REFERENCE).sort());
  });

  it.each(Object.keys(REFERENCE))('%s: reference solution gets full marks', async (key) => {
    const q = pyQs.find((x) => x.key === key)!;
    const r = await run(REFERENCE[key], q.test_cases.map((c) => c.call));
    expect(r.error).toBeNull();
    const grade = await gradeAnswer(asRow(q), { code: REFERENCE[key], outputs: r.outputs }, runSql);
    expect(grade.isCorrect).toBe(true);
  });

  it.each(Object.keys(REFERENCE))('%s: untouched starter code gets zero', async (key) => {
    const q = pyQs.find((x) => x.key === key)!;
    const r = await run(q.starter_code ?? '', q.test_cases.map((c) => c.call));
    const grade = await gradeAnswer(asRow(q), { code: q.starter_code ?? '', outputs: r.outputs }, runSql);
    expect(grade.marks).toBe(0);
  });

  it('input() is blocked and reported as an error', async () => {
    const r = await run('x = input()', []);
    expect(r.error).toMatch(/input\(\) is not available/);
  });

  it('captures stdout and runtime errors per call', async () => {
    const r = await run('print("hi")\ndef f(x):\n    return 10 / x', ['f(2)', 'f(0)']);
    expect(r.stdout.trim()).toBe('hi');
    expect(r.outputs).toEqual(['5.0', null]);
    expect(r.error).toMatch(/ZeroDivisionError/);
  });
});

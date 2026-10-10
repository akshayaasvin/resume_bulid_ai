// Loads + validates the seed question bank. Shared by scripts/db.mjs and unit tests.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seedDir = path.join(root, 'supabase', 'seed');

export function loadSeed() {
  const meta = JSON.parse(readFileSync(path.join(seedDir, 'seed.json'), 'utf8'));
  const skills = meta.skills.map((s) => {
    const questions = JSON.parse(readFileSync(path.join(seedDir, 'questions', s.file), 'utf8')).map((q) => ({
      ...q,
      sql_seed: q.sql_seed ? meta.sqlSeeds[q.sql_seed] ?? q.sql_seed : null,
      marks: q.marks ?? 1,
    }));
    return { ...s, questions };
  });
  return { ...meta, skills };
}

/** Returns a list of problems; empty means the seed is valid. */
export function validateSeed(seed) {
  const problems = [];
  const keys = new Set();
  for (const s of seed.skills) {
    const byDiff = { 1: 0, 2: 0, 3: 0 };
    for (const q of s.questions) {
      if (keys.has(q.key)) problems.push(`${q.key}: duplicate key`);
      keys.add(q.key);
      byDiff[q.difficulty] = (byDiff[q.difficulty] ?? 0) + 1;
      if (!q.body?.trim()) problems.push(`${q.key}: empty body`);
      if (q.type === 'mcq' || q.type === 'scenario') {
        if (!Array.isArray(q.options) || q.options.length !== 4) problems.push(`${q.key}: needs 4 options`);
        if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= (q.options?.length ?? 0)) problems.push(`${q.key}: bad correct index`);
        if (new Set(q.options).size !== q.options?.length) problems.push(`${q.key}: duplicate options`);
      } else if (q.type === 'code_python') {
        if (!q.test_cases?.length || q.test_cases.some((c) => !c.call || typeof c.expected !== 'string')) problems.push(`${q.key}: bad python test_cases`);
      } else if (q.type === 'sql_query') {
        if (!q.sql_seed) problems.push(`${q.key}: missing sql_seed`);
        if (!q.test_cases?.length || q.test_cases.some((c) => !Array.isArray(c.expected))) problems.push(`${q.key}: bad sql test_cases`);
      } else {
        problems.push(`${q.key}: unknown type ${q.type}`);
      }
    }
    if (s.questions.length !== 30) problems.push(`${s.slug}: expected 30 questions, found ${s.questions.length}`);
    if (byDiff[1] !== 10 || byDiff[2] !== 12 || byDiff[3] !== 8) {
      problems.push(`${s.slug}: expected 10/12/8 by difficulty, found ${byDiff[1]}/${byDiff[2]}/${byDiff[3]}`);
    }
  }
  return problems;
}

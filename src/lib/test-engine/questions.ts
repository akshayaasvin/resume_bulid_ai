import type { TestConfig } from '../config';

export type QuestionType = 'mcq' | 'scenario' | 'code_python' | 'sql_query';

export interface PythonCase { call: string; expected: string }
export interface SqlCase { expected: (string | number | null)[][]; ordered?: boolean }

/** Full question row as stored. Server-only: contains answers. */
export interface QuestionRow {
  id: string;
  skill_id: string;
  type: QuestionType;
  difficulty: 1 | 2 | 3;
  body: string;
  options: string[] | null;
  correct: number | null;
  test_cases: PythonCase[] | SqlCase[] | null;
  sql_seed: string | null;
  starter_code: string | null;
  explanation?: string | null;
  marks: number;
}

/** What the browser is allowed to see. */
export interface ClientQuestion {
  id: string;
  type: QuestionType;
  difficulty: number;
  body: string;
  marks: number;
  /** Shuffled; `key` is the original index (answers are submitted as keys). */
  options?: { key: number; text: string }[];
  starterCode?: string;
  /** Python: expressions evaluated after the candidate's code. Expected outputs stay hidden. */
  calls?: string[];
  /** SQL: schema + rows so the in-browser runner can preview results. */
  sqlSeed?: string;
}

export const isCoding = (t: QuestionType) => t === 'code_python' || t === 'sql_query';

// ---------------------------------------------------------------------------
// Deterministic RNG so a reload shows the same option order for the same attempt.
// ---------------------------------------------------------------------------
export function hashSeed(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Question selection: 5 easy / 7 medium / 3 hard, at most N coding questions.
// ---------------------------------------------------------------------------
export function pickQuestions<T extends Pick<QuestionRow, 'id' | 'type' | 'difficulty'>>(
  pool: readonly T[],
  cfg: Pick<TestConfig, 'mix' | 'maxCodingQuestions'>,
  rng: () => number,
): T[] {
  const want: Record<1 | 2 | 3, number> = { 1: cfg.mix.easy, 2: cfg.mix.medium, 3: cfg.mix.hard };
  const total = want[1] + want[2] + want[3];
  const chosen = new Set<string>();
  const picked: T[] = [];
  let coding = 0;

  const tryTake = (q: T) => {
    if (chosen.has(q.id)) return false;
    if (isCoding(q.type) && coding >= cfg.maxCodingQuestions) return false;
    chosen.add(q.id);
    picked.push(q);
    if (isCoding(q.type)) coding++;
    return true;
  };

  const byDiff = (d: 1 | 2 | 3) => shuffle(pool.filter((q) => q.difficulty === d), rng);
  const shortfall: number[] = [];
  for (const d of [1, 2, 3] as const) {
    let got = 0;
    for (const q of byDiff(d)) {
      if (got >= want[d]) break;
      if (tryTake(q)) got++;
    }
    shortfall.push(want[d] - got);
  }

  // Backfill from any difficulty (nearest first: medium, then easy, then hard) if a bucket ran dry.
  let missing = shortfall.reduce((a, b) => a + b, 0);
  if (missing > 0) {
    for (const d of [2, 1, 3] as const) {
      for (const q of byDiff(d)) {
        if (missing <= 0) break;
        if (tryTake(q)) missing--;
      }
    }
  }

  return picked
    .slice(0, total)
    .sort((a, b) => a.difficulty - b.difficulty);
}

// ---------------------------------------------------------------------------
// Sanitizing: strip everything that would reveal answers.
// ---------------------------------------------------------------------------
export function sanitizeQuestion(q: QuestionRow, attemptId: string): ClientQuestion {
  const base: ClientQuestion = {
    id: q.id,
    type: q.type,
    difficulty: q.difficulty,
    body: q.body,
    marks: Number(q.marks),
  };
  if ((q.type === 'mcq' || q.type === 'scenario') && q.options) {
    const rng = mulberry32(hashSeed(`${attemptId}:${q.id}`));
    base.options = shuffle(
      q.options.map((text, key) => ({ key, text })),
      rng,
    );
  }
  if (q.type === 'code_python') {
    base.starterCode = q.starter_code ?? '';
    base.calls = ((q.test_cases ?? []) as PythonCase[]).map((c) => c.call);
  }
  if (q.type === 'sql_query') {
    base.starterCode = q.starter_code ?? '';
    base.sqlSeed = q.sql_seed ?? '';
  }
  return base;
}

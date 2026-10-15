import { z } from 'zod';

/** Shape the model is asked to return (structured output). Strict rules are checked separately. */
export const generatedBatchSchema = z.object({
  testable: z.boolean().describe('false if the text is not a real, testable professional skill'),
  questions: z.array(
    z.object({
      type: z.string().describe('"mcq" (knowledge/practice) or "scenario" (a short workplace situation)'),
      level: z.string().describe('"beginner", "intermediate" or "advanced"'),
      question: z.string(),
      options: z.array(z.string()),
      correct_index: z.number().int(),
      explanation: z.string(),
    }),
  ),
});
export type GeneratedBatch = z.infer<typeof generatedBatchSchema>;

/** Bank size we keep for every skill, and how many a test picks (same 4/5/3 as the curated banks). */
export const BANK_TARGET = 30;
export const AI_TEST_MIX = { easy: 4, medium: 5, hard: 3 };
/** First batch is just enough for one full test, so a new skill becomes available quickly. */
export const FIRST_BATCH = 12;
export const TOPUP_BATCH = 9;

/** Per-batch level split that adds up to `n`, keeping the bank near 10 easy / 12 medium / 8 hard. */
export function levelSplit(n: number) {
  const easy = Math.round((n * 10) / 30);
  const hard = Math.round((n * 8) / 30);
  return { beginner: easy, intermediate: n - easy - hard, advanced: hard };
}

export interface ValidQuestion {
  type: 'mcq' | 'scenario'; body: string; options: string[]; correct: number; explanation: string; difficulty: 1 | 2 | 3;
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Enforces what a structured-output schema can't: the requested count, 4 distinct non-empty options,
 * a valid answer index, no repeats (within the batch or of questions already in the bank).
 */
export function checkBatch(
  t: GeneratedBatch, expected: number, existingBodies: Iterable<string> = [],
): { ok: true; questions: ValidQuestion[] } | { ok: false; reason: string } {
  if (!t.testable) return { ok: false, reason: 'not_testable' };
  if (t.questions.length !== expected) return { ok: false, reason: `expected ${expected} questions, got ${t.questions.length}` };
  const seen = new Set(Array.from(existingBodies, norm));
  const out: ValidQuestion[] = [];
  for (const [i, q] of t.questions.entries()) {
    const body = q.question.trim();
    const options = q.options.map((o) => o.trim());
    if (body.length < 10) return { ok: false, reason: `q${i + 1}: question too short` };
    if (seen.has(norm(body))) return { ok: false, reason: `q${i + 1}: duplicate question` };
    seen.add(norm(body));
    if (options.length !== 4) return { ok: false, reason: `q${i + 1}: needs 4 options` };
    if (options.some((o) => !o)) return { ok: false, reason: `q${i + 1}: empty option` };
    if (new Set(options.map(norm)).size !== 4) return { ok: false, reason: `q${i + 1}: options not unique` };
    if (!Number.isInteger(q.correct_index) || q.correct_index < 0 || q.correct_index > 3) {
      return { ok: false, reason: `q${i + 1}: bad answer index` };
    }
    const level = norm(q.level);
    out.push({
      type: /scenario/i.test(q.type) ? 'scenario' : 'mcq',
      body, options, correct: q.correct_index, explanation: q.explanation.trim(),
      difficulty: level.startsWith('begin') ? 1 : level.startsWith('adv') ? 3 : 2,
    });
  }
  return { ok: true, questions: out };
}

/** URL-safe slug for a skill name ("HTML/CSS" -> "html-css", "C++" -> "cplusplus", "C#" -> "csharp"). */
export function skillSlug(name: string): string {
  const s = name.toLowerCase().replace(/\+/g, 'plus').replace(/#/g, 'sharp').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (s || 'skill').slice(0, 50);
}

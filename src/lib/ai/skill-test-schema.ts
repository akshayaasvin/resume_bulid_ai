import { z } from 'zod';

/** Shape the model is asked to return (structured output). Strict rules are checked separately. */
export const generatedTestSchema = z.object({
  testable: z.boolean().describe('false if the text is not a real, testable professional skill'),
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()),
      correct_index: z.number().int(),
      explanation: z.string(),
      level: z.string().describe('"beginner" or "intermediate"'),
    }),
  ),
});
export type GeneratedTest = z.infer<typeof generatedTestSchema>;

export const AI_TEST_QUESTIONS = 10;

export interface ValidQuestion {
  body: string; options: string[]; correct: number; explanation: string; difficulty: 1 | 2;
}

/**
 * Enforces what a structured-output schema can't: exactly 10 questions, 4 distinct non-empty options,
 * a valid answer index. Returns the cleaned questions, or a reason string when the output is unusable.
 */
export function checkGeneratedTest(t: GeneratedTest): { ok: true; questions: ValidQuestion[] } | { ok: false; reason: string } {
  if (!t.testable) return { ok: false, reason: 'not_testable' };
  if (t.questions.length !== AI_TEST_QUESTIONS) return { ok: false, reason: `expected ${AI_TEST_QUESTIONS} questions, got ${t.questions.length}` };
  const out: ValidQuestion[] = [];
  const seenBodies = new Set<string>();
  for (const [i, q] of t.questions.entries()) {
    const body = q.question.trim();
    const options = q.options.map((o) => o.trim());
    if (body.length < 10) return { ok: false, reason: `q${i + 1}: question too short` };
    if (seenBodies.has(body.toLowerCase())) return { ok: false, reason: `q${i + 1}: duplicate question` };
    seenBodies.add(body.toLowerCase());
    if (options.length !== 4) return { ok: false, reason: `q${i + 1}: needs 4 options` };
    if (options.some((o) => !o)) return { ok: false, reason: `q${i + 1}: empty option` };
    if (new Set(options.map((o) => o.toLowerCase())).size !== 4) return { ok: false, reason: `q${i + 1}: options not unique` };
    if (!Number.isInteger(q.correct_index) || q.correct_index < 0 || q.correct_index > 3) {
      return { ok: false, reason: `q${i + 1}: bad answer index` };
    }
    out.push({
      body, options, correct: q.correct_index, explanation: q.explanation.trim(), difficulty: /^\s*begin/i.test(q.level) ? 1 : 2,
    });
  }
  return { ok: true, questions: out };
}

/** Question mix for a generated test: use all of them. */
export function mixFor(questions: ValidQuestion[]) {
  return {
    easy: questions.filter((q) => q.difficulty === 1).length,
    medium: questions.filter((q) => q.difficulty === 2).length,
    hard: 0,
  };
}

/** URL-safe slug for a skill name ("HTML/CSS" -> "html-css", "C++" -> "cplusplus", "C#" -> "csharp"). */
export function skillSlug(name: string): string {
  const s = name.toLowerCase().replace(/\+/g, 'plus').replace(/#/g, 'sharp').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (s || 'skill').slice(0, 50);
}

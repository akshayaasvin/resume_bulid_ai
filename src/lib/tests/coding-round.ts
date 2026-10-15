import 'server-only';
import { adminClient } from '../supabase/admin';
import { getConfig } from '../server-config';
import { answerSchema, gradeAnswer } from '../test-engine/grading';
import { sanitizeQuestion, shuffle, type ClientQuestion, type QuestionRow } from '../test-engine/questions';
import { TestError } from '../test-engine/service';
import { runSqlOnServer } from '../test-engine/sql-runner';

/** Groups after which the optional coding round is offered, and the question type per skill. */
export const CODING_GROUPS = ['programming', 'data'];
const CODING_TYPE: Record<string, 'code_python' | 'sql_query'> = { python: 'code_python', sql: 'sql_query' };
export const CODING_QUESTIONS = 2;
const COLUMNS = 'id, skill_id, type, difficulty, body, options, correct, test_cases, sql_seed, starter_code, marks';

export interface CodingResult { passed: number; total: number; verified: boolean }
export interface CodingRoundView { roundId: string; skill: string; questions: ClientQuestion[]; result: CodingResult | null }

/** Python / SQL skills of a finished Programming / Data group test that can get a coding round. */
export async function codingOffer(attempt: { id: string; cluster_id: string; status: string; plan: { skill: string; skill_id: string }[] }) {
  if (attempt.status !== 'submitted' || !CODING_GROUPS.includes(attempt.cluster_id)) return [];
  const db = adminClient();
  const ids = attempt.plan.map((p) => p.skill_id);
  const [{ data: skills }, { data: rounds }] = await Promise.all([
    db.from('skills').select('id, slug').in('id', ids),
    db.from('coding_rounds').select('skill_id, status, passed, total').eq('cluster_attempt_id', attempt.id),
  ]);
  const threshold = (await getConfig('scoring')).beginnerMin;
  return attempt.plan.flatMap((p) => {
    const slug = (skills ?? []).find((s) => s.id === p.skill_id)?.slug as string | undefined;
    if (!slug || !CODING_TYPE[slug]) return [];
    const r = (rounds ?? []).find((x) => x.skill_id === p.skill_id);
    const result = r?.status === 'submitted' ? toResult(r.passed ?? 0, r.total ?? 0, threshold) : null;
    return [{ skill: p.skill, skillId: p.skill_id, result }];
  });
}

const toResult = (passed: number, total: number, threshold: number): CodingResult =>
  ({ passed, total, verified: total > 0 && (passed / total) * 100 >= threshold });

/** Starts (or reopens) the coding round for one Python / SQL skill of a finished group test. */
export async function startCodingRound(profileId: string, clusterAttemptId: string, skillId: string): Promise<CodingRoundView> {
  const db = adminClient();
  const { data: attempt } = await db.from('cluster_attempts').select('id, profile_id, cluster_id, status, plan').eq('id', clusterAttemptId).maybeSingle();
  if (!attempt || attempt.profile_id !== profileId) throw new TestError('not_found', 404);
  const offer = await codingOffer(attempt as Parameters<typeof codingOffer>[0]);
  const item = offer.find((o) => o.skillId === skillId);
  if (!item) throw new TestError('not_offered', 400);

  let { data: round } = await db.from('coding_rounds').select('*').eq('cluster_attempt_id', clusterAttemptId).eq('skill_id', skillId).maybeSingle();
  if (!round) {
    const { data: skill } = await db.from('skills').select('slug').eq('id', skillId).single();
    const { data: pool } = await db.from('questions').select('id').eq('skill_id', skillId).eq('status', 'published')
      .eq('type', CODING_TYPE[skill?.slug as string]);
    const picked = shuffle((pool ?? []).map((q) => q.id as string), Math.random).slice(0, CODING_QUESTIONS);
    if (!picked.length) throw new TestError('no_questions', 409);
    const { data: created, error } = await db.from('coding_rounds').insert({
      profile_id: profileId, cluster_attempt_id: clusterAttemptId, skill_id: skillId, question_ids: picked,
    }).select('*').single();
    if (error?.code === '23505') {
      ({ data: round } = await db.from('coding_rounds').select('*').eq('cluster_attempt_id', clusterAttemptId).eq('skill_id', skillId).single());
    } else if (error || !created) throw new TestError('start_failed', 500);
    else round = created;
  }
  const { data: qs } = await db.from('questions').select(COLUMNS).in('id', round!.question_ids as string[]);
  const byId = new Map(((qs ?? []) as QuestionRow[]).map((q) => [q.id, q]));
  const questions = (round!.question_ids as string[]).flatMap((id) => (byId.has(id) ? [sanitizeQuestion(byId.get(id)!, round!.id)] : []));
  return { roundId: round!.id as string, skill: item.skill, questions, result: item.result };
}

/** Grades the round with the existing grader. Separate from the MCQ score (skill_scores untouched). */
export async function submitCodingRound(profileId: string, roundId: string, raw: unknown): Promise<CodingResult> {
  const db = adminClient();
  const { data: round } = await db.from('coding_rounds').select('*').eq('id', roundId).maybeSingle();
  if (!round || round.profile_id !== profileId) throw new TestError('not_found', 404);
  const threshold = (await getConfig('scoring')).beginnerMin;
  if (round.status === 'submitted') return toResult(round.passed ?? 0, round.total ?? 0, threshold);

  const { data: qs } = await db.from('questions').select(COLUMNS).in('id', round.question_ids as string[]);
  const answers = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const results = await Promise.all(((qs ?? []) as QuestionRow[]).map((q) => {
    const a = answerSchema.safeParse(answers[q.id]);
    return gradeAnswer(q, a.success ? a.data : null, runSqlOnServer);
  }));
  const passed = results.filter((r) => r.isCorrect).length;
  const total = (round.question_ids as string[]).length;
  await db.from('coding_rounds').update({ status: 'submitted', passed, total, submitted_at: new Date().toISOString() })
    .eq('id', roundId).eq('status', 'in_progress');
  return toResult(passed, total, threshold);
}

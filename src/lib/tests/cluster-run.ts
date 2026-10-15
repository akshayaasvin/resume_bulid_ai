import 'server-only';
import { adminClient } from '../supabase/admin';
import { getConfig } from '../server-config';
import { answerSchema, gradeAnswer } from '../test-engine/grading';
import { sanitizeQuestion, type ClientQuestion, type QuestionRow } from '../test-engine/questions';
import { TestError } from '../test-engine/service';
import { runSqlOnServer } from '../test-engine/sql-runner';
import { nextSkill, skillStopped, type AnswerMark } from './clusters';
import type { PlanItem } from './cluster-start';
import { finalizeCluster } from './cluster-finalize';

const QUESTION_COLUMNS = 'id, skill_id, type, difficulty, body, options, correct, test_cases, sql_seed, starter_code, marks';

export interface ClusterAttemptRow {
  id: string; profile_id: string; cluster_id: string; plan: PlanItem[];
  status: 'in_progress' | 'submitted'; expires_at: string; results: Record<string, number> | null;
  started_at: string; submitted_at: string | null;
  mode: 'self' | 'campus'; proctor_verified: boolean; grace_minutes: number;
  tab_switches: number; fullscreen_exits: number; flagged: boolean;
}

export interface ClusterState {
  attemptId: string;
  clusterId: string;
  status: 'in_progress' | 'submitted';
  expiresAt: string;
  serverNow: string;
  /** Planned questions (an early stop on a skill ends it sooner). */
  total: number;
  answered: number;
  skills: { skill: string; count: number; answered: number; stopped: boolean }[];
  question: (ClientQuestion & { skill: string }) | null;
  /** Per-skill score % once submitted. */
  results: Record<string, number> | null;
  /** Scores at/above this are verified (same cut-off as the resume). */
  threshold: number;
  mode: 'self' | 'campus';
  tabSwitches: number;
  flagged: boolean;
}

async function loadOwned(attemptId: string, profileId: string) {
  const { data } = await adminClient().from('cluster_attempts').select('*').eq('id', attemptId).maybeSingle<ClusterAttemptRow>();
  if (!data || data.profile_id !== profileId) throw new TestError('not_found', 404);
  return data;
}

async function marksFor(attempt: ClusterAttemptRow): Promise<AnswerMark[]> {
  const { data } = await adminClient().from('cluster_attempt_answers').select('skill_id, is_correct, seq')
    .eq('attempt_id', attempt.id).order('seq');
  const nameOf = new Map(attempt.plan.map((p) => [p.skill_id, p.skill]));
  return (data ?? []).map((a) => ({ skill: nameOf.get(a.skill_id as string) ?? '', correct: !!a.is_correct }));
}

/** The question the candidate must answer next (adaptive), or null when the test is complete. */
async function expectedQuestionId(attempt: ClusterAttemptRow, marks: AnswerMark[]): Promise<string | null> {
  const skill = nextSkill(attempt.plan, marks);
  if (!skill) return null;
  const item = attempt.plan.find((p) => p.skill === skill)!;
  return item.question_ids[marks.filter((m) => m.skill === skill).length] ?? null;
}

export async function loadClusterState(attemptId: string, profileId: string): Promise<ClusterState> {
  let attempt = await loadOwned(attemptId, profileId);
  let marks = await marksFor(attempt);
  let nextId = attempt.status === 'in_progress' ? await expectedQuestionId(attempt, marks) : null;
  if (attempt.status === 'in_progress' && (!nextId || Date.now() > new Date(attempt.expires_at).getTime())) {
    await finalizeCluster(attempt, marks);
    attempt = await loadOwned(attemptId, profileId);
    marks = await marksFor(attempt);
    nextId = null;
  }

  let question: ClusterState['question'] = null;
  if (nextId) {
    const { data: q } = await adminClient().from('questions').select(QUESTION_COLUMNS).eq('id', nextId).single<QuestionRow>();
    const skill = attempt.plan.find((p) => p.question_ids.includes(nextId!))!.skill;
    if (q) question = { ...sanitizeQuestion(q, attempt.id), skill };
  }
  return {
    attemptId: attempt.id,
    clusterId: attempt.cluster_id,
    status: attempt.status,
    expiresAt: attempt.expires_at,
    serverNow: new Date().toISOString(),
    total: attempt.plan.reduce((n, p) => n + p.count, 0),
    answered: marks.length,
    skills: attempt.plan.map((p) => ({
      skill: p.skill, count: p.count, answered: marks.filter((m) => m.skill === p.skill).length, stopped: skillStopped(p.skill, marks),
    })),
    question,
    results: attempt.results,
    threshold: (await getConfig('scoring')).beginnerMin,
    mode: attempt.mode ?? 'self',
    tabSwitches: attempt.tab_switches ?? 0,
    flagged: !!attempt.flagged,
  };
}

/** Tab switch / fullscreen exit during a group test (shown on the proctor board, can flag the attempt). */
export async function recordClusterEvent(attemptId: string, profileId: string, kind: 'tab' | 'fullscreen') {
  await loadOwned(attemptId, profileId);
  const scoring = await getConfig('scoring');
  const { data } = await adminClient().rpc('bump_cluster_attempt_counter', {
    p_attempt: attemptId, p_kind: kind, p_flag_after: scoring.autoFlagAfter,
  });
  return (data as { tab_switches: number; fullscreen_exits: number; flagged: boolean }[] | null)?.[0] ?? null;
}

/** Grades one answer on the server (it must be for the expected question) and returns the next state. */
export async function answerClusterQuestion(attemptId: string, profileId: string, questionId: string, raw: unknown): Promise<ClusterState> {
  const attempt = await loadOwned(attemptId, profileId);
  // Submitted, or time is up (loading finalises it): late answers are not recorded.
  if (attempt.status !== 'in_progress' || Date.now() > new Date(attempt.expires_at).getTime()) {
    return loadClusterState(attemptId, profileId);
  }
  const marks = await marksFor(attempt);
  const expected = await expectedQuestionId(attempt, marks);
  if (expected !== questionId) {
    // a double-tap or a stale screen: just show the current question again
    return loadClusterState(attemptId, profileId);
  }
  const parsed = answerSchema.safeParse(raw);
  const db = adminClient();
  const { data: q } = await db.from('questions').select(QUESTION_COLUMNS).eq('id', questionId).single<QuestionRow>();
  if (!q) throw new TestError('not_found', 404);
  const result = await gradeAnswer(q, parsed.success ? parsed.data : null, runSqlOnServer);
  const item = attempt.plan.find((p) => p.question_ids.includes(questionId))!;
  await db.from('cluster_attempt_answers').upsert({
    attempt_id: attemptId, question_id: questionId, skill_id: item.skill_id, seq: marks.length,
    answer: parsed.success ? parsed.data : null, is_correct: result.isCorrect,
  }, { onConflict: 'attempt_id,question_id', ignoreDuplicates: true });
  return loadClusterState(attemptId, profileId);
}

import 'server-only';
import { adminClient } from '../supabase/admin';
import { getConfig } from '../server-config';
import { findCatalogSkill } from '../skill-alias';
import { pickQuestions, type QuestionRow } from '../test-engine/questions';
import { TestError, checkPin } from '../test-engine/service';
import { prepareInBackground } from '../ai/skill-tests';
import { track } from '../funnel';
import { MIN_PER_SKILL, clusterById, offeredClusters, planCluster, type ClusterId } from './clusters';

export interface PlanItem { skill: string; skill_id: string; count: number; question_ids: string[] }

type PoolQ = Pick<QuestionRow, 'id' | 'type' | 'difficulty'> & { skill_id: string };

/** Easy-leaning mix for n questions of one skill (e.g. 3 -> 1/2/0, 5 -> 2/2/1). */
function mixFor(n: number) {
  const easy = Math.round(n * 0.4);
  const hard = Math.floor(n * 0.2);
  return { easy, medium: n - easy - hard, hard };
}

export interface StartOptions {
  mode: 'self' | 'campus';
  /** Workshop PIN (campus mode). */
  pin?: string;
  deviceId: string;
  /** The candidate's workshop (campus mode needs one). */
  workshopId: string | null;
}

/**
 * Starts (or resumes) the candidate's combined test for one skill group. Only MCQ / scenario
 * questions, 15 in total, split over the group's selected skills that have a question bank.
 */
export async function startClusterTest(
  profileId: string, clusterId: ClusterId, opts: StartOptions = { mode: 'self', deviceId: '', workshopId: null },
): Promise<{ attemptId: string; resumed: boolean }> {
  const db = adminClient();
  const now = new Date();

  const { data: open } = await db.from('cluster_attempts').select('id')
    .eq('profile_id', profileId).eq('cluster_id', clusterId).eq('status', 'in_progress').gt('expires_at', now.toISOString())
    .order('started_at', { ascending: false }).limit(1).maybeSingle();
  if (open) return { attemptId: open.id as string, resumed: true };

  const [{ data: claimed }, { data: catalog }] = await Promise.all([
    db.from('claimed_skills').select('name').eq('profile_id', profileId),
    db.from('skills').select('id, name').eq('is_active', true),
  ]);
  const selected = offeredClusters((claimed ?? []).map((c) => c.name as string)).clusters.find((c) => c.id === clusterId)?.skills ?? [];
  if (!selected.length) throw new TestError('not_in_cluster', 400);

  const cat = (catalog ?? []) as { id: string; name: string }[];
  const matched = selected.map((name) => ({ name, skill: findCatalogSkill(name, cat) }));
  const ids = matched.flatMap((m) => (m.skill ? [m.skill.id] : []));
  const { data: pool } = ids.length
    ? await db.from('questions').select('id, type, difficulty, skill_id').in('skill_id', ids).eq('status', 'published').in('type', ['mcq', 'scenario'])
    : { data: [] as PoolQ[] };
  const bySkill = new Map<string, PoolQ[]>();
  for (const q of (pool ?? []) as PoolQ[]) bySkill.set(q.skill_id, [...(bySkill.get(q.skill_id) ?? []), q]);

  const ready = matched.filter((m) => m.skill && (bySkill.get(m.skill.id)?.length ?? 0) >= MIN_PER_SKILL);
  // Skills without a bank yet: build it in the background so they can be verified later.
  prepareInBackground(matched.filter((m) => !ready.includes(m)).map((m) => m.name), profileId);
  if (!ready.length) throw new TestError('no_questions', 409);

  const plan: PlanItem[] = planCluster(ready.map((m) => m.name)).map(({ skill, count }) => {
    const m = ready.find((r) => r.name === skill)!;
    const picked = pickQuestions(bySkill.get(m.skill!.id)!, { mix: mixFor(count), maxCodingQuestions: 0 }, Math.random);
    return { skill: m.skill!.name, skill_id: m.skill!.id, count: picked.length, question_ids: picked.map((q) => q.id) };
  });

  const cfg = await getConfig('test');
  // Workshop (campus) mode: same PIN check and lockout as per-skill tests.
  let workshop: { id: string; late_grace_minutes: number } | null = null;
  if (opts.mode === 'campus') {
    if (!opts.workshopId) throw new TestError('no_workshop', 400);
    if (!opts.pin) throw new TestError('pin_required', 400);
    workshop = await checkPin(profileId, opts.deviceId, opts.workshopId, opts.pin);
  }
  const { data: attempt, error } = await db.from('cluster_attempts').insert({
    profile_id: profileId, cluster_id: clusterId, plan,
    mode: opts.mode, workshop_id: workshop?.id ?? null, proctor_verified: !!workshop,
    grace_minutes: workshop ? workshop.late_grace_minutes : cfg.selfModeGraceMinutes,
    started_at: now.toISOString(), expires_at: new Date(now.getTime() + cfg.durationMinutes * 60_000).toISOString(),
  }).select('id').single();
  if (error || !attempt) throw new TestError('start_failed', 500);
  await track(profileId, 'test_started', { cluster: clusterById(clusterId).id, skills: plan.length, mode: opts.mode });
  return { attemptId: attempt.id as string, resumed: false };
}

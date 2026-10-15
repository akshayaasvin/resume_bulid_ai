import 'server-only';
import { adminClient } from '../supabase/admin';
import { getConfig } from '../server-config';
import { badgeFor, isBetterScore, isPublicScore, levelFor, type Badge } from '../scoring';
import { createResumeVersion } from '../resume/versions';
import { syncFlowStep } from '../flow-server';
import { track } from '../funnel';
import { notifyClusterScoreInBackground } from '../whatsapp/notify';
import { clusterById, isClusterId, skillScores, type AnswerMark } from './clusters';
import type { ClusterAttemptRow } from './cluster-run';

/**
 * Scores a cluster test per skill and records each skill's best score (existing best-score rule).
 * Idempotent: only the call that flips the attempt to 'submitted' writes scores.
 */
export async function finalizeCluster(attempt: ClusterAttemptRow, marks: AnswerMark[]): Promise<void> {
  const db = adminClient();
  const scoring = await getConfig('scoring');
  const results = skillScores(attempt.plan, marks);
  const { data: claimed } = await db.from('cluster_attempts')
    .update({ status: 'submitted', submitted_at: new Date().toISOString(), results })
    .eq('id', attempt.id).eq('status', 'in_progress').select('id');
  if (!claimed?.length) return; // another request finalised it

  // Same badge rule as per-skill tests: campus + valid PIN + few tab switches + on time = campus verified.
  const badge: Badge = badgeFor({
    mode: attempt.mode ?? 'self',
    proctorVerified: !!attempt.proctor_verified,
    tabSwitches: attempt.tab_switches ?? 0,
    flagged: !!attempt.flagged,
    submittedAt: new Date(),
    expiresAt: new Date(attempt.expires_at),
    graceMinutes: attempt.grace_minutes ?? 0,
  }, scoring);
  let newPublicScore = false;
  for (const p of attempt.plan) {
    const pct = results[p.skill];
    const { data: existing } = await db.from('skill_scores').select('score_pct, badge')
      .eq('profile_id', attempt.profile_id).eq('skill_id', p.skill_id).maybeSingle();
    const prev = existing ? { scorePct: Number(existing.score_pct), badge: existing.badge as Badge } : null;
    if (!isBetterScore({ scorePct: pct, badge }, prev)) continue;
    await db.from('skill_scores').upsert({
      profile_id: attempt.profile_id, skill_id: p.skill_id, best_attempt_id: null,
      score_pct: pct, level: levelFor(pct, scoring), badge, updated_at: new Date().toISOString(),
    });
    if (isPublicScore(pct, scoring)) newPublicScore = true;
  }

  // A new verified resume only when something visible on it changed.
  if (newPublicScore) await createResumeVersion(attempt.profile_id, 'verified').catch((e) => console.error('resume version failed', e));
  await syncFlowStep(attempt.profile_id).catch((e) => console.error('flow sync failed', e));
  await track(attempt.profile_id, 'test_submitted', { cluster: attempt.cluster_id, results });
  if (isClusterId(attempt.cluster_id)) {
    notifyClusterScoreInBackground(attempt.profile_id, clusterById(attempt.cluster_id).label, results);
  }
}

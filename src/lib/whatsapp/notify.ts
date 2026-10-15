import 'server-only';
import { waitUntil } from '@vercel/functions';
import { adminClient } from '../supabase/admin';
import { getConfig } from '../server-config';
import { sendWhatsApp } from './index';
import { SKILL_SCORE_TEMPLATE, appBaseUrl, clusterResultText, skillScoreParams } from './message';

/**
 * After a test is submitted and scored: if the candidate opted in, send "skill_score_update".
 * Returns what happened (for tests / logs). Never throws.
 */
export async function notifySkillScore(profileId: string, attemptId: string): Promise<string> {
  try {
    const db = adminClient();
    const [{ data: profile }, { data: attempt }] = await Promise.all([
      db.from('profiles').select('full_name, phone_whatsapp, whatsapp_opt_in').eq('id', profileId).maybeSingle(),
      db.from('attempts').select('profile_id, status, score_pct, skills(name)').eq('id', attemptId).maybeSingle(),
    ]);
    if (!profile?.whatsapp_opt_in) return 'not_opted_in';
    if (!profile.phone_whatsapp) return 'no_phone';
    if (!attempt || attempt.profile_id !== profileId || attempt.status !== 'submitted' || attempt.score_pct == null) return 'not_scored';

    const scoring = await getConfig('scoring');
    const base = appBaseUrl();
    const params = skillScoreParams({
      name: profile.full_name as string,
      skill: (attempt as unknown as { skills: { name: string } | null }).skills?.name ?? 'your skill',
      scorePct: Number(attempt.score_pct),
      threshold: scoring.beginnerMin,
      resumeUrl: `${base}/resume`,
      ctaUrl: (process.env.WHATSAPP_CTA_URL || `${base}/roles`).replace(/\/+$/, ''),
    });
    return await sendWhatsApp(profile.phone_whatsapp as string, SKILL_SCORE_TEMPLATE, params, { profileId, attemptId });
  } catch (e) {
    console.error('skill score notification failed', e instanceof Error ? e.message : 'unknown');
    return 'error';
  }
}

/** Fire-and-forget after the response is sent (Vercel waitUntil). */
export function notifySkillScoreInBackground(profileId: string, attemptId: string) {
  waitUntil(notifySkillScore(profileId, attemptId));
}

/**
 * After a combined (skill group) test: one "skill_score_update" message for the group, with the
 * group name as {{2}}. No dedupe key: the test is finalised only once.
 */
export async function notifyClusterScore(profileId: string, groupLabel: string, results: Record<string, number>): Promise<string> {
  try {
    const db = adminClient();
    const { data: profile } = await db.from('profiles').select('full_name, phone_whatsapp, whatsapp_opt_in').eq('id', profileId).maybeSingle();
    if (!profile?.whatsapp_opt_in) return 'not_opted_in';
    if (!profile.phone_whatsapp) return 'no_phone';
    const scoring = await getConfig('scoring');
    const base = appBaseUrl();
    const [firstName, skill, , resumeUrl, ctaUrl] = skillScoreParams({
      name: profile.full_name as string, skill: groupLabel, scorePct: 0, threshold: scoring.beginnerMin,
      resumeUrl: `${base}/resume`, ctaUrl: (process.env.WHATSAPP_CTA_URL || `${base}/roles`).replace(/\/+$/, ''),
    });
    const params = [firstName, skill, clusterResultText(results, scoring.beginnerMin), resumeUrl, ctaUrl];
    return await sendWhatsApp(profile.phone_whatsapp as string, SKILL_SCORE_TEMPLATE, params, { profileId });
  } catch (e) {
    console.error('cluster score notification failed', e instanceof Error ? e.message : 'unknown');
    return 'error';
  }
}

export function notifyClusterScoreInBackground(profileId: string, groupLabel: string, results: Record<string, number>) {
  waitUntil(notifyClusterScore(profileId, groupLabel, results));
}

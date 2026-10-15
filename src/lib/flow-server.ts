import 'server-only';
import { adminClient } from './supabase/admin';
import { computeStep, isFlowStep, laterStep, type FlowStep } from './flow';
import { canonicalSkillName, findCatalogSkill, normSkill } from './skill-alias';
import { skillTestStatuses } from './ai/skill-tests';

/** Counts the candidate's tested skills and how many declared skills have / can get / can't get a test. */
export async function testProgress(profileId: string) {
  const db = adminClient();
  const [{ data: claimed }, { data: catalog }, { count }] = await Promise.all([
    db.from('claimed_skills').select('skill_id, name').eq('profile_id', profileId),
    db.from('skills').select('id, name').eq('is_active', true),
    db.from('skill_scores').select('skill_id', { count: 'exact', head: true }).eq('profile_id', profileId),
  ]);
  const cat = (catalog ?? []) as { id: string; name: string }[];
  const ids = new Set(cat.map((c) => c.id));
  const rows = (claimed ?? []) as { skill_id: string | null; name: string }[];
  const untested = rows.filter((c) => !((c.skill_id && ids.has(c.skill_id)) || findCatalogSkill(c.name, cat)));
  // Untested skills: 'pending' ones will get a bank in the background; failed / not-a-skill ones can't right now.
  const statuses = await skillTestStatuses(untested.map((c) => c.name));
  const unavailable = untested.filter((c) => {
    const st = statuses.get(normSkill(canonicalSkillName(c.name)))?.state;
    return st === 'failed' || st === 'not_testable';
  }).length;
  return {
    completedTests: count ?? 0,
    testable: rows.length - untested.length,
    waiting: untested.length - unavailable,
    unavailable,
  };
}

/**
 * Recomputes the candidate's funnel step from their data and stores it on the profile
 * (service role: candidates cannot write current_step themselves). Never moves backwards.
 */
export async function syncFlowStep(profileId: string): Promise<FlowStep> {
  const db = adminClient();
  const { data: profile, error } = await db.from('profiles').select('wizard_step, current_step').eq('id', profileId).single();
  const progress = await testProgress(profileId);
  if (error) {
    // current_step column missing (migration 0005 not applied yet): derive only, don't store.
    const { data: p } = await db.from('profiles').select('wizard_step').eq('id', profileId).single();
    return computeStep({ wizardStep: p?.wizard_step ?? 0, ...progress });
  }
  const stored = isFlowStep(profile.current_step) ? profile.current_step : null;
  const step = laterStep(stored, computeStep({ wizardStep: profile.wizard_step ?? 0, ...progress }));
  if (step !== stored) await db.from('profiles').update({ current_step: step }).eq('id', profileId);
  return step;
}

import 'server-only';
import { adminClient } from '../supabase/admin';
import { getConfig } from '../server-config';

/**
 * Skill names whose coding round passed (>= the verified threshold, 50% by default). Read-only:
 * coding rounds never change skill_scores or the MCQ %. Missing table = none.
 */
export async function codingVerifiedSkills(profileId: string): Promise<string[]> {
  const [{ data }, scoring] = await Promise.all([
    adminClient().from('coding_rounds').select('passed, total, skills(name)').eq('profile_id', profileId).eq('status', 'submitted'),
    getConfig('scoring'),
  ]);
  const names = new Set<string>();
  for (const r of (data ?? []) as unknown as { passed: number | null; total: number | null; skills: { name: string } | null }[]) {
    const total = r.total ?? 0;
    if (r.skills?.name && total > 0 && ((r.passed ?? 0) / total) * 100 >= scoring.beginnerMin) names.add(r.skills.name);
  }
  return [...names];
}

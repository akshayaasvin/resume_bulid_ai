import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from './server-config';
import { isPublicScore, type Badge, type SkillLevel } from './scoring';

export interface SkillOverviewRow {
  skillId: string | null;
  slug: string | null;
  name: string;
  claimed: boolean;
  testable: boolean;
  score: { pct: number; level: SkillLevel; badge: Badge; public: boolean } | null;
}

/** Claimed vs verified, per skill, for the signed-in candidate (RLS-scoped client). */
export async function skillOverview(supabase: SupabaseClient, profileId: string) {
  const [cfg, { data: claimed }, { data: scores }, { data: catalog }] = await Promise.all([
    getConfig('scoring'),
    supabase.from('claimed_skills').select('skill_id, name').eq('profile_id', profileId),
    supabase.from('skill_scores').select('skill_id, score_pct, level, badge').eq('profile_id', profileId),
    supabase.from('skills').select('id, slug, name').eq('is_active', true).order('name'),
  ]);
  const cat = (catalog ?? []) as { id: string; slug: string; name: string }[];
  const byName = new Map(cat.map((c) => [c.name.toLowerCase(), c]));
  const byId = new Map(cat.map((c) => [c.id, c]));
  const scoreBy = new Map(((scores ?? []) as { skill_id: string; score_pct: number; level: SkillLevel; badge: Badge }[]).map((s) => [s.skill_id, s]));

  const rows: SkillOverviewRow[] = [];
  const seen = new Set<string>();
  for (const c of (claimed ?? []) as { skill_id: string | null; name: string }[]) {
    const skill = (c.skill_id && byId.get(c.skill_id)) || byName.get(c.name.toLowerCase()) || null;
    const s = skill ? scoreBy.get(skill.id) : undefined;
    if (skill) seen.add(skill.id);
    rows.push({
      skillId: skill?.id ?? null,
      slug: skill?.slug ?? null,
      name: skill?.name ?? c.name,
      claimed: true,
      testable: !!skill,
      score: s ? { pct: Number(s.score_pct), level: s.level, badge: s.badge, public: isPublicScore(Number(s.score_pct), cfg) } : null,
    });
  }
  // Tested but not claimed (e.g. tried an extra test).
  for (const [skillId, s] of Array.from(scoreBy.entries())) {
    if (seen.has(skillId)) continue;
    const skill = byId.get(skillId);
    seen.add(skillId);
    rows.push({
      skillId, slug: skill?.slug ?? null, name: skill?.name ?? '?', claimed: false, testable: !!skill,
      score: { pct: Number(s.score_pct), level: s.level, badge: s.badge, public: isPublicScore(Number(s.score_pct), cfg) },
    });
  }
  const others = cat.filter((c) => !seen.has(c.id));
  return { rows, others, cfg };
}

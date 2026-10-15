import { z } from 'zod';
import { apiSession } from '@/lib/auth';
import { ensureSkillTest } from '@/lib/ai/skill-tests';
import { syncFlowStep } from '@/lib/flow-server';
import { canonicalSkillName, normSkill } from '@/lib/skill-alias';

// Generation (with one retry) can take a while on the first request for a skill.
export const maxDuration = 60;

const schema = z.object({ skill: z.string().trim().min(2).max(60) });

/**
 * Returns the test slug for one of the candidate's declared skills, generating (and caching for
 * everyone) an AI test when the skill has no question bank. Answers never leave the server:
 * the test is started and graded through the normal /api/test endpoints.
 */
export async function POST(req: Request) {
  const auth = await apiSession(['candidate']);
  if ('error' in auth) return auth.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 });
  const { supabase, profile } = auth.session;

  // Only skills the candidate actually declared (stops arbitrary generation requests).
  const key = normSkill(canonicalSkillName(parsed.data.skill));
  const { data: claimed } = await supabase.from('claimed_skills').select('name').eq('profile_id', profile.id);
  if (!(claimed ?? []).some((c) => normSkill(canonicalSkillName(c.name as string)) === key)) {
    return Response.json({ error: 'not_declared' }, { status: 403 });
  }

  const result = await ensureSkillTest(parsed.data.skill, profile.id);
  // Success adds a testable skill; failure may unlock job matches (fallback). Either way, re-sync.
  await syncFlowStep(profile.id).catch((e) => console.error('flow sync failed', e));
  if (result.ok) return Response.json({ slug: result.slug, cached: result.cached });
  const status = result.reason === 'rate_limited' ? 429 : result.reason === 'not_testable' ? 422 : 503;
  return Response.json({ error: result.reason }, { status });
}

import { z } from 'zod';
import { apiSession } from '@/lib/auth';
import { prepareInBackground, skillTestStatuses } from '@/lib/ai/skill-tests';
import { syncFlowStep } from '@/lib/flow-server';
import { clusterOf } from '@/lib/tests/clusters';
import { canonicalSkillName, normSkill } from '@/lib/skill-alias';

// Background generation (waitUntil) runs inside this function's time limit.
export const maxDuration = 60;

const schema = z.object({ skills: z.array(z.string().trim().min(2).max(60)).min(1).max(30) });

/**
 * Returns the test status of the candidate's declared skills without waiting for any generation,
 * and starts background bank generation for those that don't have a test yet. Polled by the hub.
 */
export async function POST(req: Request) {
  const auth = await apiSession(['candidate']);
  if ('error' in auth) return auth.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 });
  const { supabase, profile } = auth.session;

  // Only skills the candidate actually declared (stops arbitrary generation requests).
  const { data: claimed } = await supabase.from('claimed_skills').select('name').eq('profile_id', profile.id);
  const declared = new Set((claimed ?? []).map((c) => normSkill(canonicalSkillName(c.name as string))));
  const names = Array.from(new Set(parsed.data.skills)).filter((n) => declared.has(normSkill(canonicalSkillName(n))));
  if (!names.length) return Response.json({ statuses: {} });

  const statuses = await skillTestStatuses(names);
  prepareInBackground(names.filter((n) => clusterOf(n) && statuses.get(normSkill(canonicalSkillName(n)))?.state === 'pending'), profile.id);

  // A skill that just became ready (or failed) can change what's needed to unlock job matches.
  await syncFlowStep(profile.id).catch((e) => console.error('flow sync failed', e));
  return Response.json({
    statuses: Object.fromEntries(names.map((n) => [n, statuses.get(normSkill(canonicalSkillName(n)))])),
  });
}

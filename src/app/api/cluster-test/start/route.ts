import { z } from 'zod';
import { apiSession } from '@/lib/auth';
import { CLUSTERS } from '@/lib/tests/clusters';
import { startClusterTest } from '@/lib/tests/cluster-start';
import { deviceId, errorResponse } from '../../test/_util';

// Skills without a question bank get one built in the background (waitUntil).
export const maxDuration = 60;

const schema = z.object({
  cluster: z.enum(CLUSTERS.map((c) => c.id) as [string, ...string[]]),
  mode: z.enum(['self', 'campus']).default('self'),
  pin: z.string().max(10).optional(),
});

/** Starts (or resumes) the combined test for one skill group. */
export async function POST(req: Request) {
  const auth = await apiSession(['candidate']);
  if ('error' in auth) return auth.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 });
  try {
    const { profile } = auth.session;
    return Response.json(await startClusterTest(profile.id, parsed.data.cluster as (typeof CLUSTERS)[number]['id'], {
      mode: parsed.data.mode, pin: parsed.data.pin, deviceId: deviceId(), workshopId: profile.workshop_id,
    }));
  } catch (e) {
    return errorResponse(e);
  }
}

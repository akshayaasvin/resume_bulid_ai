import { z } from 'zod';
import { apiSession } from '@/lib/auth';
import { startCodingRound } from '@/lib/tests/coding-round';
import { errorResponse } from '../../test/_util';

const schema = z.object({ cluster_attempt_id: z.string().uuid(), skill_id: z.string().uuid() });

/** Optional coding round after a Programming / Data group test: 2 Python or SQL questions. */
export async function POST(req: Request) {
  const auth = await apiSession(['candidate']);
  if ('error' in auth) return auth.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 });
  try {
    return Response.json(await startCodingRound(auth.session.profile.id, parsed.data.cluster_attempt_id, parsed.data.skill_id));
  } catch (e) {
    return errorResponse(e);
  }
}

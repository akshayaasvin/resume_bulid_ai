import { z } from 'zod';
import { apiSession } from '@/lib/auth';
import { recordClusterEvent } from '@/lib/tests/cluster-run';
import { errorResponse, isUuid } from '../../../test/_util';

const schema = z.object({ kind: z.enum(['tab', 'fullscreen']) });

/** Records a tab switch / fullscreen exit during a group test (proctor board + auto-flag). */
export async function POST(req: Request, { params }: { params: { attemptId: string } }) {
  const auth = await apiSession(['candidate']);
  if ('error' in auth) return auth.error;
  if (!isUuid(params.attemptId)) return Response.json({ error: 'not_found' }, { status: 404 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 });
  try {
    return Response.json(await recordClusterEvent(params.attemptId, auth.session.profile.id, parsed.data.kind) ?? {});
  } catch (e) {
    return errorResponse(e);
  }
}

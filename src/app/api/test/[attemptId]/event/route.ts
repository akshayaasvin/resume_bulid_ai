import { z } from 'zod';
import { apiSession } from '@/lib/auth';
import { recordEvent } from '@/lib/test-engine/service';
import { errorResponse, isUuid } from '../../_util';

const schema = z.object({ kind: z.enum(['tab', 'fullscreen']) });

export async function POST(req: Request, { params }: { params: { attemptId: string } }) {
  const auth = await apiSession(['candidate']);
  if ('error' in auth) return auth.error;
  if (!isUuid(params.attemptId)) return Response.json({ error: 'not_found' }, { status: 404 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 });
  try {
    return Response.json((await recordEvent(params.attemptId, auth.session.profile.id, parsed.data.kind)) ?? {});
  } catch (e) {
    return errorResponse(e);
  }
}

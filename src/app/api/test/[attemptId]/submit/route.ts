import { apiSession } from '@/lib/auth';
import { finalizeAttempt } from '@/lib/test-engine/service';
import { syncFlowStep } from '@/lib/flow-server';
import { errorResponse, isUuid } from '../../_util';

export const maxDuration = 30;

export async function POST(req: Request, { params }: { params: { attemptId: string } }) {
  const auth = await apiSession(['candidate']);
  if ('error' in auth) return auth.error;
  if (!isUuid(params.attemptId)) return Response.json({ error: 'not_found' }, { status: 404 });
  const body = await req.json().catch(() => null);
  try {
    const result = await finalizeAttempt(params.attemptId, auth.session.profile.id, body?.answers);
    await syncFlowStep(auth.session.profile.id).catch((e) => console.error('flow sync failed', e));
    return Response.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}

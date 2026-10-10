import { apiSession } from '@/lib/auth';
import { loadAttempt } from '@/lib/test-engine/service';
import { errorResponse, isUuid } from '../_util';

export async function GET(_req: Request, { params }: { params: { attemptId: string } }) {
  const auth = await apiSession(['candidate']);
  if ('error' in auth) return auth.error;
  if (!isUuid(params.attemptId)) return Response.json({ error: 'not_found' }, { status: 404 });
  try {
    return Response.json(await loadAttempt(params.attemptId, auth.session.profile.id), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

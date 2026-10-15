import { apiSession } from '@/lib/auth';
import { loadClusterState } from '@/lib/tests/cluster-run';
import { errorResponse, isUuid } from '../../test/_util';

// Finishing a test (scores, resume version, WhatsApp in the background) can happen on this call.
export const maxDuration = 30;

/** Current question (sanitised, no answers) or the per-skill results once finished. */
export async function GET(_req: Request, { params }: { params: { attemptId: string } }) {
  const auth = await apiSession(['candidate']);
  if ('error' in auth) return auth.error;
  if (!isUuid(params.attemptId)) return Response.json({ error: 'not_found' }, { status: 404 });
  try {
    return Response.json(await loadClusterState(params.attemptId, auth.session.profile.id));
  } catch (e) {
    return errorResponse(e);
  }
}

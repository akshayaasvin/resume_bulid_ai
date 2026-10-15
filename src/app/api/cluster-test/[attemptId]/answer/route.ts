import { z } from 'zod';
import { apiSession } from '@/lib/auth';
import { answerClusterQuestion } from '@/lib/tests/cluster-run';
import { errorResponse, isUuid } from '../../../test/_util';

export const maxDuration = 30;

const schema = z.object({ question_id: z.string().uuid(), answer: z.unknown() });

/** Grades one answer on the server and returns the next question (adaptive) or the results. */
export async function POST(req: Request, { params }: { params: { attemptId: string } }) {
  const auth = await apiSession(['candidate']);
  if ('error' in auth) return auth.error;
  if (!isUuid(params.attemptId)) return Response.json({ error: 'not_found' }, { status: 404 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 });
  try {
    return Response.json(await answerClusterQuestion(params.attemptId, auth.session.profile.id, parsed.data.question_id, parsed.data.answer));
  } catch (e) {
    return errorResponse(e);
  }
}

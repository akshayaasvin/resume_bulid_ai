import { z } from 'zod';
import { apiSession } from '@/lib/auth';
import { submitCodingRound } from '@/lib/tests/coding-round';
import { errorResponse, isUuid } from '../../../test/_util';

export const maxDuration = 30;

const schema = z.object({ answers: z.record(z.string(), z.unknown()) });

/** Grades the coding round (existing grader); does not change the MCQ skill score. */
export async function POST(req: Request, { params }: { params: { roundId: string } }) {
  const auth = await apiSession(['candidate']);
  if ('error' in auth) return auth.error;
  if (!isUuid(params.roundId)) return Response.json({ error: 'not_found' }, { status: 404 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 });
  try {
    return Response.json(await submitCodingRound(auth.session.profile.id, params.roundId, parsed.data.answers));
  } catch (e) {
    return errorResponse(e);
  }
}

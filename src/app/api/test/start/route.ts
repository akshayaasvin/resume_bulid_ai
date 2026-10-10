import { z } from 'zod';
import { apiSession } from '@/lib/auth';
import { startAttempt } from '@/lib/test-engine/service';
import { deviceId, errorResponse } from '../_util';

const schema = z.object({
  skill: z.string().regex(/^[a-z0-9-]+$/).max(60),
  mode: z.enum(['self', 'campus']),
  pin: z.string().max(10).optional(),
});

export async function POST(req: Request) {
  const auth = await apiSession(['candidate']);
  if ('error' in auth) return auth.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 });
  try {
    const { profile } = auth.session;
    const r = await startAttempt({
      profileId: profile.id,
      workshopId: profile.workshop_id,
      deviceId: deviceId(),
      skillSlug: parsed.data.skill,
      mode: parsed.data.mode,
      pin: parsed.data.pin,
    });
    return Response.json(r);
  } catch (e) {
    return errorResponse(e);
  }
}

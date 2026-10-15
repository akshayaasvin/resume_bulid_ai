import { z } from 'zod';
import { apiSession } from '@/lib/auth';
import { syncFlowStep } from '@/lib/flow-server';
import { roleById } from '@/lib/onboarding/roles';

const schema = z.object({ role_id: z.string().max(60) });

/** Saves the candidate's target role (step 8). The resume is tailored to it. */
export async function POST(req: Request) {
  const auth = await apiSession(['candidate']);
  if ('error' in auth) return auth.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  const role = parsed.success ? roleById(parsed.data.role_id) : null;
  if (!role) return Response.json({ error: 'invalid_role' }, { status: 400 });

  const { supabase, profile } = auth.session;
  const { error } = await supabase.from('profiles')
    .update({ target_role_id: role.id, target_role: role.title }).eq('id', profile.id);
  if (error) {
    console.error('saving target role failed', error.code);
    return Response.json({ error: 'save_failed' }, { status: 500 });
  }
  const step = await syncFlowStep(profile.id);
  return Response.json({ ok: true, step });
}

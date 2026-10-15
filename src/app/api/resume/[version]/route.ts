import { z } from 'zod';
import { apiSession } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { TEMPLATE_IDS } from '@/lib/resume/templates';

const schema = z.object({ template_id: z.enum(TEMPLATE_IDS) });

/** Saves the template chosen for one of the caller's resume versions. */
export async function PATCH(req: Request, { params }: { params: { version: string } }) {
  const auth = await apiSession(['candidate']);
  if ('error' in auth) return auth.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  const version = Number(params.version);
  if (!parsed.success || !Number.isInteger(version) || version < 1) return Response.json({ error: 'invalid_input' }, { status: 400 });

  const { supabase, profile } = auth.session;
  // Ownership check through RLS; the write itself is server-only (resumes have no client write policy).
  const { data: resume } = await supabase.from('resumes').select('id').eq('profile_id', profile.id).eq('version', version).maybeSingle();
  if (!resume) return Response.json({ error: 'not_found' }, { status: 404 });
  const { error } = await adminClient().from('resumes').update({ template_id: parsed.data.template_id }).eq('id', resume.id);
  if (error) return Response.json({ error: 'save_failed' }, { status: 500 });
  return Response.json({ ok: true });
}

import { z } from 'zod';
import { apiSession } from '@/lib/auth';

/** Self-service profile fields. Protected fields (role, college, workshop, phone) are blocked by a DB trigger too. */
const schema = z.object({
  full_name: z.string().trim().min(2).max(100).optional(),
  name_tamil: z.string().trim().max(100).nullable().optional(),
  email: z.string().trim().email().max(200).nullable().optional().or(z.literal('')),
  department: z.string().trim().max(100).nullable().optional(),
  year: z.number().int().min(1).max(6).nullable().optional(),
  summary: z.string().trim().max(800).nullable().optional(),
  whatsapp_opt_in: z.boolean().optional(),
  show_score_pct: z.boolean().optional(),
  recruiter_visible: z.boolean().optional(),
}).strict();

export async function PATCH(req: Request) {
  const auth = await apiSession();
  if ('error' in auth) return auth.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 });
  const patch = { ...parsed.data, ...(parsed.data.email === '' ? { email: null } : {}) };
  const { supabase, user } = auth.session;
  const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
  if (error) return Response.json({ error: 'save_failed' }, { status: 500 });
  return Response.json({ ok: true });
}

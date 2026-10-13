import { z } from 'zod';
import { adminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { authEmailForPhone, normalizeIndianPhone } from '@/lib/phone';
import { withBackoff } from '@/lib/retry';
import { track } from '@/lib/funnel';

const schema = z.object({
  full_name: z.string().trim().min(2).max(100),
  name_tamil: z.string().trim().max(100).optional().or(z.literal('')),
  phone: z.string().min(10).max(16),
  password: z.string().min(6).max(72),
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  department: z.string().trim().max(100).optional().or(z.literal('')),
  year: z.coerce.number().int().min(1).max(6).optional(),
  college_id: z.string().uuid().optional().or(z.literal('')),
  batch_code: z.string().trim().toUpperCase().max(32).optional().or(z.literal('')),
  whatsapp_opt_in: z.boolean().default(false),
  language: z.enum(['en', 'ta']).default('en'),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_input', issues: parsed.error.issues }, { status: 400 });
  const input = parsed.data;

  const phone = normalizeIndianPhone(input.phone);
  if (!phone) return Response.json({ error: 'invalid_phone' }, { status: 400 });

  const admin = adminClient();

  let collegeId: string | null = input.college_id || null;
  let workshopId: string | null = null;
  if (input.batch_code) {
    const { data: ws } = await admin
      .from('workshops')
      .select('id, college_id, is_active')
      .eq('batch_code', input.batch_code)
      .maybeSingle<{ id: string; college_id: string; is_active: boolean }>();
    if (!ws || !ws.is_active) return Response.json({ error: 'invalid_batch' }, { status: 400 });
    collegeId = ws.college_id;
    workshopId = ws.id;
  }

  const email = authEmailForPhone(phone);
  // Admin API: no per-IP signup rate limit, account is created already confirmed.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  });
  if (createErr || !created.user) {
    const exists = /already|registered|exists/i.test(createErr?.message ?? '');
    return Response.json(
      { error: exists ? 'phone_taken' : 'signup_failed' },
      { status: exists ? 409 : 500 },
    );
  }

  const { error: profileErr } = await admin.from('profiles').insert({
    id: created.user.id,
    role: 'candidate',
    full_name: input.full_name,
    name_tamil: input.name_tamil || null,
    phone_whatsapp: phone,
    email: input.email || null,
    department: input.department || null,
    year: input.year ?? null,
    college_id: collegeId,
    workshop_id: workshopId,
    whatsapp_opt_in: input.whatsapp_opt_in,
    opt_in_at: input.whatsapp_opt_in ? new Date().toISOString() : null,
    language: input.language,
    wizard_step: 1,
    current_step: 'wizard',
  });
  if (profileErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    const dup = profileErr.code === '23505';
    return Response.json({ error: dup ? 'phone_taken' : 'signup_failed' }, { status: dup ? 409 : 500 });
  }

  // Session is issued server-side; cookies are written by the SSR client.
  const supabase = createClient();
  const { error: signInErr } = await withBackoff(
    () => supabase.auth.signInWithPassword({ email, password: input.password }),
    (r) => r.error?.status === 429 || (r.error?.status ?? 0) >= 500,
  );

  await track(created.user.id, 'registered', { workshop_id: workshopId });

  if (signInErr) return Response.json({ ok: true, next: '/login?registered=1' });
  return Response.json({ ok: true, next: '/wizard' });
}

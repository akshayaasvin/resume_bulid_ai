import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { authEmailForPhone, normalizeIndianPhone } from '@/lib/phone';
import { withBackoff } from '@/lib/retry';

const schema = z.object({ phone: z.string().min(10).max(16), password: z.string().min(1).max(72) });

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 });
  const phone = normalizeIndianPhone(parsed.data.phone);
  if (!phone) return Response.json({ error: 'invalid_phone' }, { status: 400 });

  const supabase = createClient();
  const { data, error } = await withBackoff(
    () => supabase.auth.signInWithPassword({ email: authEmailForPhone(phone), password: parsed.data.password }),
    (r) => r.error?.status === 429 || (r.error?.status ?? 0) >= 500,
  );
  if (error || !data.user) {
    const status = error?.status === 429 ? 429 : 401;
    return Response.json({ error: status === 429 ? 'rate_limited' : 'bad_credentials' }, { status });
  }

  const { data: profile } = await supabase.from('profiles').select('role, wizard_step').eq('id', data.user.id).single();
  const next =
    profile?.role === 'super_admin' ? '/admin'
    : profile?.role === 'college_admin' ? '/tpo'
    : profile?.role === 'employer' ? '/employer'
    : (profile?.wizard_step ?? 0) < 4 ? '/wizard'
    : '/dashboard';
  return Response.json({ ok: true, next });
}

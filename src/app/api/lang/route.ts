import { cookies } from 'next/headers';
import { z } from 'zod';
import { getSession } from '@/lib/auth';

const schema = z.object({ lang: z.enum(['en', 'ta']) });

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 });
  cookies().set('lang', parsed.data.lang, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  const s = await getSession();
  if (s) await s.supabase.from('profiles').update({ language: parsed.data.lang }).eq('id', s.user.id);
  return Response.json({ ok: true });
}

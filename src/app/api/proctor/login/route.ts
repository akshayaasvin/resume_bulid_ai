import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { adminClient } from '@/lib/supabase/admin';
import { setProctorSession } from '@/lib/proctor-session';

const schema = z.object({ batch_code: z.string().trim().toUpperCase().max(32), password: z.string().min(1).max(100) });

const DUMMY_HASH = bcrypt.hashSync('timing-parity', 10);

// Same response for unknown batch and wrong password (no batch enumeration).
const DENY = () => Response.json({ error: 'bad_credentials' }, { status: 401 });

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 });
  const { data: ws } = await adminClient()
    .from('workshops').select('id, proctor_password_hash, is_active')
    .eq('batch_code', parsed.data.batch_code).maybeSingle();
  if (!ws?.proctor_password_hash || !ws.is_active) {
    await bcrypt.compare(parsed.data.password, DUMMY_HASH); // timing parity
    return DENY();
  }
  const ok = await bcrypt.compare(parsed.data.password, ws.proctor_password_hash);
  if (!ok) return DENY();
  setProctorSession(ws.id);
  return Response.json({ ok: true });
}

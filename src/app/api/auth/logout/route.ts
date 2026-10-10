import { createClient } from '@/lib/supabase/server';

export async function POST() {
  await createClient().auth.signOut();
  return Response.json({ ok: true });
}

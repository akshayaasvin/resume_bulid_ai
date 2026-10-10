import { adminClient } from '@/lib/supabase/admin';
import { proctorWorkshopId } from '@/lib/proctor-session';
import { boardData } from '@/lib/proctor-board';

export async function GET(_req: Request, { params }: { params: { batch_code: string } }) {
  const wid = proctorWorkshopId();
  if (!wid) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  const { data: ws } = await adminClient()
    .from('workshops').select('id').eq('batch_code', params.batch_code.toUpperCase()).maybeSingle();
  if (!ws || ws.id !== wid) return Response.json({ error: 'forbidden' }, { status: 403 });
  const data = await boardData(wid);
  return Response.json(data, { headers: { 'cache-control': 'no-store' } });
}

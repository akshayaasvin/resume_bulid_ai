import { headers } from 'next/headers';
import QRCode from 'qrcode';
import { ProctorBoard } from '@/components/proctor/ProctorBoard';
import { ProctorLogin } from '@/components/proctor/ProctorLogin';
import { adminClient } from '@/lib/supabase/admin';
import { proctorWorkshopId } from '@/lib/proctor-session';
import { boardData } from '@/lib/proctor-board';

export const dynamic = 'force-dynamic';

export default async function ProctorPage({ params }: { params: { batch_code: string } }) {
  const code = decodeURIComponent(params.batch_code).toUpperCase();
  const { data: ws } = await adminClient().from('workshops').select('id, name').eq('batch_code', code).maybeSingle();
  const wid = proctorWorkshopId();

  if (!ws || wid !== ws.id) {
    return <ProctorLogin batchCode={code} />;
  }

  const h = headers();
  const origin = process.env.NEXT_PUBLIC_APP_URL || `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`;
  const joinUrl = `${origin.replace(/\/$/, '')}/join/${encodeURIComponent(code)}`;
  const qr = await QRCode.toDataURL(joinUrl, { width: 640, margin: 1, errorCorrectionLevel: 'M' });
  const initial = await boardData(ws.id);

  return <ProctorBoard batchCode={code} joinUrl={joinUrl} qr={qr} initial={initial!} />;
}

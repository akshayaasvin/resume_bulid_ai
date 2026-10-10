import { apiSession } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { renderResumePdf } from '@/lib/resume/pdf';
import type { ResumeSnapshot } from '@/lib/resume/snapshot';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** Streams the PDF for one of the caller's resume versions; renders once and caches in Storage. */
export async function GET(_req: Request, { params }: { params: { version: string } }) {
  const auth = await apiSession(['candidate']);
  if ('error' in auth) return auth.error;
  const { supabase, profile } = auth.session;
  const version = Number(params.version);
  if (!Number.isInteger(version) || version < 1) return Response.json({ error: 'not_found' }, { status: 404 });

  // RLS: only the owner's rows are visible.
  const { data: resume } = await supabase
    .from('resumes').select('id, version, snapshot').eq('profile_id', profile.id).eq('version', version).maybeSingle();
  if (!resume) return Response.json({ error: 'not_found' }, { status: 404 });

  const showPct = profile.show_score_pct;
  const objectPath = `${profile.id}/v${version}${showPct ? '-pct' : ''}.pdf`;
  const storage = adminClient().storage.from('resumes');

  let pdf: Buffer | null = null;
  const cached = await storage.download(objectPath);
  if (cached.data) pdf = Buffer.from(await cached.data.arrayBuffer());
  if (!pdf) {
    pdf = await renderResumePdf(resume.snapshot as ResumeSnapshot, showPct, version);
    const up = await storage.upload(objectPath, pdf, { contentType: 'application/pdf', upsert: true });
    if (!up.error) await adminClient().from('resumes').update({ pdf_path: objectPath }).eq('id', resume.id);
  }

  const safeName = profile.full_name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'resume';
  return new Response(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${safeName}_Resume_v${version}.pdf"`,
      'cache-control': 'private, no-store',
    },
  });
}

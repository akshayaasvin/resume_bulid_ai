import { apiSession } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { renderFittedResumePdf, type FitStatus } from '@/lib/resume/pdf';
import type { ResumeSnapshot } from '@/lib/resume/snapshot';
import { isTemplateId, recommendTemplate, type TemplateId } from '@/lib/resume/templates';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * Streams the one-page PDF for one of the caller's resume versions.
 * ?template=<id> previews another template (default: the version's saved template);
 * ?inline=1 serves it for the in-page preview instead of as a download.
 * The X-Resume-Fit header says how the content was fitted (ok / shrunk / trimmed / overflow).
 * Each (version, template, score %) PDF is rendered once and cached in Storage.
 */
export async function GET(req: Request, { params }: { params: { version: string } }) {
  const auth = await apiSession(['candidate']);
  if ('error' in auth) return auth.error;
  const { supabase, profile } = auth.session;
  const version = Number(params.version);
  if (!Number.isInteger(version) || version < 1) return Response.json({ error: 'not_found' }, { status: 404 });

  // RLS: only the owner's rows are visible. select('*') so a missing template_id column is fine.
  const { data: resume } = await supabase
    .from('resumes').select('*').eq('profile_id', profile.id).eq('version', version).maybeSingle();
  if (!resume) return Response.json({ error: 'not_found' }, { status: 404 });

  const url = new URL(req.url);
  const requested = url.searchParams.get('template');
  const saved = (resume as { template_id?: string }).template_id;
  const roleId = (profile as typeof profile & { target_role_id?: string | null }).target_role_id;
  const template: TemplateId = isTemplateId(requested) ? requested : isTemplateId(saved) ? saved : recommendTemplate(roleId);
  const inline = url.searchParams.get('inline') === '1';

  const showPct = profile.show_score_pct;
  const objectPath = `${profile.id}/v${version}-${template}${showPct ? '-pct' : ''}.pdf`;
  const storage = adminClient().storage.from('resumes');

  let pdf: Buffer | null = null;
  let status: FitStatus = 'ok';
  const cached = await storage.download(objectPath);
  if (cached.data) {
    pdf = Buffer.from(await cached.data.arrayBuffer());
    // the fit outcome is stored next to the PDF
    const meta = await storage.download(`${objectPath}.fit`);
    if (meta.data) status = ((await meta.data.text()).trim() as FitStatus) || 'ok';
  }
  if (!pdf) {
    const fitted = await renderFittedResumePdf(resume.snapshot as ResumeSnapshot, showPct, version, template);
    pdf = fitted.pdf;
    status = fitted.status;
    const up = await storage.upload(objectPath, pdf, { contentType: 'application/pdf', upsert: true });
    await storage.upload(`${objectPath}.fit`, new Blob([status], { type: 'text/plain' }), { upsert: true });
    if (!up.error && template === saved) await adminClient().from('resumes').update({ pdf_path: objectPath }).eq('id', resume.id);
  }

  const safeName = profile.full_name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'resume';
  return new Response(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeName}_Resume_v${version}.pdf"`,
      'cache-control': 'private, no-store',
      'x-resume-fit': status,
      'x-resume-template': template,
    },
  });
}

import Link from 'next/link';
import { AppHeader } from '@/components/AppHeader';
import { RefreshWhile } from '@/components/RefreshWhile';
import { ResumeStudio } from '@/components/resume/ResumeStudio';
import { ResumeView } from '@/components/resume/ResumeView';
import { ShowPctToggle } from '@/components/resume/ShowPctToggle';
import { WhatsAppToggle } from '@/components/WhatsAppToggle';
import { getT } from '@/i18n/server';
import { requireSession } from '@/lib/auth';
import type { ResumeSnapshot } from '@/lib/resume/snapshot';
import { isTemplateId, recommendTemplate } from '@/lib/resume/templates';

export const dynamic = 'force-dynamic';

export default async function ResumePage({ searchParams }: { searchParams: { v?: string } }) {
  const { supabase, profile } = await requireSession(['candidate']);
  const { t } = getT();
  const p = profile as typeof profile & { target_role_id?: string | null; target_role?: string | null };
  const [{ data: versions }, { data: tailoring }] = await Promise.all([
    supabase.from('resumes').select('*').eq('profile_id', profile.id).order('version', { ascending: false }),
    supabase.from('resume_tailoring').select('status, updated_at').eq('profile_id', profile.id).maybeSingle(),
  ]);
  const list = (versions ?? []) as { version: number; kind: string; snapshot: ResumeSnapshot; template_id?: string | null }[];
  const selected = list.find((r) => r.version === Number(searchParams.v)) ?? list[0];
  const recommended = recommendTemplate(p.target_role_id);
  // AI tailoring for a newly picked role runs in the background (a minute at most).
  const tailoringPending = tailoring?.status === 'pending' && Date.now() - new Date(tailoring.updated_at).getTime() < 2 * 60_000;

  return (
    <>
      <AppHeader signedIn home="/dashboard" />
      <main className="mx-auto max-w-3xl space-y-4 px-4 pb-16 pt-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{t('resume.title')}</h1>
          <Link href="/dashboard" className="shrink-0 text-sm text-brand-700">← {t('common.back')}</Link>
        </div>
        {p.target_role && (
          <p className="text-sm text-slate-600">
            {t('resume.forRole', { role: p.target_role })} · <Link href="/roles" className="text-brand-700 underline">{t('resume.changeRole')}</Link>
          </p>
        )}
        {tailoringPending && (
          <p role="status" className="flex items-center gap-2 rounded-lg bg-brand-50 p-3 text-sm text-brand-700">
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" aria-hidden />
            {t('resume.tailoring', { role: p.target_role ?? '' })}
            <RefreshWhile active everyMs={4000} maxMs={2 * 60_000} />
          </p>
        )}
        {!selected ? (
          <div className="card space-y-3">
            <p>{t('resume.empty')}</p>
            <Link href="/wizard" className="btn-primary">{t('wizard.title')}</Link>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {list.map((r) => (
                <Link key={r.version} href={`/resume?v=${r.version}`}
                  className={`chip ${r.version === selected.version ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
                  {t('resume.version', { v: r.version })}{r.kind === 'verified' ? ' ✓' : r.kind === 'tailored' ? ' ★' : ''}
                </Link>
              ))}
            </div>
            <ShowPctToggle initial={profile.show_score_pct} />
            <WhatsAppToggle initial={profile.whatsapp_opt_in} />
            <ResumeStudio
              key={selected.version}
              version={selected.version}
              initial={isTemplateId(selected.template_id) ? selected.template_id : recommended}
              recommended={recommended}
              showPct={profile.show_score_pct}
            />
            <details className="rounded-xl border border-slate-200 bg-white">
              <summary className="cursor-pointer p-3 text-sm text-slate-700">{t('resume.textVersion')}</summary>
              <div className="overflow-x-auto border-t border-slate-200">
                <ResumeView s={selected.snapshot} showPct={profile.show_score_pct} />
              </div>
            </details>
          </>
        )}
      </main>
    </>
  );
}

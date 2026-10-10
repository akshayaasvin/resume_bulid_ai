import Link from 'next/link';
import { AppHeader } from '@/components/AppHeader';
import { ResumeView } from '@/components/resume/ResumeView';
import { ShowPctToggle } from '@/components/resume/ShowPctToggle';
import { getT } from '@/i18n/server';
import { requireSession } from '@/lib/auth';
import type { ResumeSnapshot } from '@/lib/resume/snapshot';

export const dynamic = 'force-dynamic';

export default async function ResumePage({ searchParams }: { searchParams: { v?: string } }) {
  const { supabase, profile } = await requireSession(['candidate']);
  const { t } = getT();
  const { data: versions } = await supabase
    .from('resumes').select('version, kind, created_at, snapshot').eq('profile_id', profile.id).order('version', { ascending: false });
  const list = (versions ?? []) as { version: number; kind: string; created_at: string; snapshot: ResumeSnapshot }[];
  const selected = list.find((r) => r.version === Number(searchParams.v)) ?? list[0];

  return (
    <>
      <AppHeader signedIn home="/dashboard" />
      <main className="mx-auto max-w-3xl space-y-4 px-4 pb-16 pt-5">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t('resume.title')}</h1>
          <Link href="/dashboard" className="text-sm text-brand-700">← {t('common.back')}</Link>
        </div>
        {!selected ? (
          <div className="card space-y-3">
            <p>{t('resume.empty')}</p>
            <Link href="/wizard" className="btn-primary">{t('wizard.title')}</Link>
          </div>
        ) : (
          <>
            <div className="card flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {list.map((r) => (
                  <Link key={r.version} href={`/resume?v=${r.version}`}
                    className={`chip ${r.version === selected.version ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
                    {t('resume.version', { v: r.version })}{r.kind === 'verified' ? ' ✓' : ''}
                  </Link>
                ))}
              </div>
              <a href={`/api/resume/${selected.version}/pdf`} className="btn-primary" download>
                ⬇ {t('resume.download')}
              </a>
            </div>
            <ShowPctToggle initial={profile.show_score_pct} />
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <ResumeView s={selected.snapshot} showPct={profile.show_score_pct} />
            </div>
          </>
        )}
      </main>
    </>
  );
}

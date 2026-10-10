import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { BadgeChip, LevelChip } from '@/components/Badges';
import { PendingSubmitter } from '@/components/PendingSubmitter';
import { RunnerStatus } from '@/components/RunnerStatus';
import { getT } from '@/i18n/server';
import { requireSession } from '@/lib/auth';
import { skillOverview } from '@/lib/candidate-data';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const { supabase, profile } = await requireSession(['candidate']);
  if (profile.wizard_step < 4) redirect('/wizard');
  const { t } = getT();
  const { rows, others } = await skillOverview(supabase, profile.id);
  const kinds = rows.filter((r) => r.slug === 'python' || r.slug === 'sql').map((r) => r.slug as 'python' | 'sql');

  return (
    <>
      <AppHeader signedIn home="/dashboard" />
      <main className="mx-auto max-w-2xl space-y-5 px-4 pb-16 pt-5">
        <h1 className="text-2xl font-bold">{t('dash.hello', { name: profile.full_name.split(' ')[0] })}</h1>
        <PendingSubmitter />
        <div className="grid grid-cols-3 gap-2">
          <Link href="/resume" className="btn-secondary px-2 text-sm">{t('dash.viewResume')}</Link>
          <Link href="/results" className="btn-secondary px-2 text-sm">{t('dash.results')}</Link>
          <Link href="/wizard?step=1" className="btn-secondary px-2 text-sm">{t('dash.editProfile')}</Link>
        </div>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t('dash.yourSkills')}</h2>
            <RunnerStatus kinds={kinds} />
          </div>
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.name} className="card flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.score && r.score.public ? (
                      <>
                        <LevelChip level={r.score.level} label={t(`level.${r.score.level}`)} />
                        <BadgeChip badge={r.score.badge} label={t(`badge.${r.score.badge}`)} />
                      </>
                    ) : r.score ? (
                      <LevelChip level="needs_improvement" label={t('level.needs_improvement')} />
                    ) : (
                      <span className="text-xs text-slate-500">{t('dash.notTested')}</span>
                    )}
                  </div>
                </div>
                {r.testable && r.slug && (
                  <Link href={`/test/${r.slug}`} className={r.score ? 'btn-secondary shrink-0 text-sm' : 'btn-primary shrink-0 text-sm'}>
                    {r.score ? t('dash.retake') : t('dash.takeTest')}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>

        {others.length > 0 && (
          <section>
            <h2 className="mb-2 text-lg font-semibold">{t('dash.otherTests')}</h2>
            <div className="flex flex-wrap gap-2">
              {others.map((s) => (
                <Link key={s.id} href={`/test/${s.slug}`} className="rounded-full border border-slate-300 bg-white px-3 py-2 text-sm">
                  {s.name} →
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  );
}

import Link from 'next/link';
import { AppHeader } from '@/components/AppHeader';
import { BadgeChip, LevelChip } from '@/components/Badges';
import { PendingSubmitter } from '@/components/PendingSubmitter';
import { getT } from '@/i18n/server';
import { requireSession } from '@/lib/auth';
import { skillOverview } from '@/lib/candidate-data';
import { levelFor } from '@/lib/scoring';

export const dynamic = 'force-dynamic';

export default async function ResultsPage({ searchParams }: { searchParams: { attempt?: string } }) {
  const { supabase, profile } = await requireSession(['candidate']);
  const { t } = getT();
  const { rows, cfg } = await skillOverview(supabase, profile.id);

  type Latest = { score_pct: number; badge: string; flagged: boolean; skills: { name: string } | null };
  let latest: Latest | null = null;
  if (searchParams.attempt && /^[0-9a-f-]{36}$/i.test(searchParams.attempt)) {
    const { data } = await supabase
      .from('attempts').select('score_pct, badge, flagged, skills(name)')
      .eq('id', searchParams.attempt).eq('status', 'submitted').maybeSingle();
    latest = data as Latest | null;
  }

  const verified = rows.filter((r) => r.score?.public);
  const gaps = rows.filter((r) => r.score && !r.score.public);
  const latestLevel = latest ? levelFor(Number(latest.score_pct), cfg) : null;
  const latestPublic = latest ? Number(latest.score_pct) >= cfg.beginnerMin : false;

  return (
    <>
      <AppHeader signedIn home="/test" />
      <main className="mx-auto max-w-2xl space-y-5 px-4 pb-16 pt-5">
        <h1 className="text-2xl font-bold">{t('results.title')}</h1>
        <PendingSubmitter />

        {latest && latestLevel && (
          <section className={`card ${latestPublic ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
            <p className="text-sm text-slate-600">{latest.skills?.name}</p>
            <p className="mt-1 text-3xl font-bold">{Math.round(Number(latest.score_pct))}%</p>
            <div className="mt-2 flex flex-wrap gap-1">
              <LevelChip level={latestLevel} label={t(`level.${latestLevel}`)} />
              {latestPublic && <BadgeChip badge={latest.badge as 'self'} label={t(`badge.${latest.badge}`)} />}
            </div>
            {latest.flagged && <p className="mt-2 text-sm text-red-700">{t('test.flagged')}</p>}
            {!latestPublic && <p className="mt-2 text-sm text-amber-800">{t('results.gapHint')}</p>}
          </section>
        )}

        <section className="card overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-3 py-2">{t('results.skill')}</th>
                <th className="px-3 py-2">{t('results.claimed')}</th>
                <th className="px-3 py-2">{t('results.verified')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2">{r.claimed ? '✓' : '–'}</td>
                  <td className="px-3 py-2">
                    {r.score?.public ? (
                      <div className="flex flex-wrap gap-1">
                        <LevelChip level={r.score.level} label={t(`level.${r.score.level}`)} />
                        <BadgeChip badge={r.score.badge} label={t(`badge.${r.score.badge}`)} />
                      </div>
                    ) : r.score ? (
                      <span className="text-amber-700">{t('level.needs_improvement')}</span>
                    ) : r.testable && r.slug ? (
                      <Link className="text-brand-700 underline" href={`/test/${r.slug}`}>{t('dash.takeTest')}</Link>
                    ) : (
                      <span className="text-slate-400">{t('dash.notTested')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="mb-1 text-lg font-semibold">{t('results.gaps')}</h2>
          {gaps.length ? (
            <>
              <p className="mb-2 text-sm text-slate-600">{t('results.gapHint')}</p>
              <ul className="space-y-2">
                {gaps.map((g) => (
                  <li key={g.name} className="card flex items-center justify-between">
                    <span className="font-medium">{g.name}</span>
                    {g.slug && <Link href={`/test/${g.slug}`} className="btn-secondary text-sm">{t('dash.retake')}</Link>}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-slate-600">{t('results.noGaps')}</p>
          )}
        </section>

        {verified.length > 0 && (
          <Link href="/resume" className="btn-primary w-full">{t('results.downloadResume')}</Link>
        )}
        <Link href="/test" className="btn-secondary w-full">{t('hub.backToTests')}</Link>
      </main>
    </>
  );
}

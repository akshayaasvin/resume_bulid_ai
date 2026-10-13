import Link from 'next/link';
import { AppHeader } from '@/components/AppHeader';
import { BadgeChip, LevelChip } from '@/components/Badges';
import { PendingSubmitter } from '@/components/PendingSubmitter';
import { RunnerStatus } from '@/components/RunnerStatus';
import { getT } from '@/i18n/server';
import { requireSession } from '@/lib/auth';
import { skillOverview, type SkillOverviewRow } from '@/lib/candidate-data';
import { STEP_HOME, requiredTests } from '@/lib/flow';
import { syncFlowStep } from '@/lib/flow-server';

export const dynamic = 'force-dynamic';

/** Skill-test hub: the candidate's declared skills, each with status + start, and the gate to the next step. */
export default async function TestHub() {
  const { supabase, profile } = await requireSession(['candidate']);
  const { t } = getT();
  const [{ rows, others }, step] = await Promise.all([skillOverview(supabase, profile.id), syncFlowStep(profile.id)]);

  const declared = rows.filter((r) => r.claimed);
  const extra = rows.filter((r) => !r.claimed);
  const completed = rows.filter((r) => r.score).length;
  const required = requiredTests(declared.filter((r) => r.testable).length);
  const unlocked = completed >= required || step === 'done';
  const kinds = rows.filter((r) => r.slug === 'python' || r.slug === 'sql').map((r) => r.slug as 'python' | 'sql');

  return (
    <>
      <AppHeader signedIn home="/test" />
      <main className="mx-auto max-w-2xl space-y-5 px-4 pb-28 pt-5">
        <div>
          <h1 className="text-2xl font-bold">{t('hub.title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('hub.intro', { n: required })}</p>
        </div>
        <PendingSubmitter />

        <div className="card">
          <div className="flex items-center justify-between text-sm font-medium">
            <span>{t('hub.progress', { done: Math.min(completed, required), total: required })}</span>
            <RunnerStatus kinds={kinds} />
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar"
            aria-valuemin={0} aria-valuemax={required} aria-valuenow={Math.min(completed, required)}>
            <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${Math.min(100, (completed / required) * 100)}%` }} />
          </div>
        </div>

        <section>
          <h2 className="mb-2 text-lg font-semibold">{t('hub.yourSkills')}</h2>
          {declared.length === 0 ? (
            <div className="card space-y-2 text-sm">
              <p>{t('hub.noSkills')}</p>
              <Link href="/wizard?step=3" className="btn-secondary">{t('hub.addSkills')}</Link>
            </div>
          ) : (
            <ul className="space-y-2">
              {declared.map((r) => <SkillRow key={r.name} r={r} t={t} />)}
            </ul>
          )}
        </section>

        {extra.length > 0 && (
          <section>
            <h2 className="mb-2 text-lg font-semibold">{t('hub.extraTested')}</h2>
            <ul className="space-y-2">{extra.map((r) => <SkillRow key={r.name} r={r} t={t} />)}</ul>
          </section>
        )}

        {others.length > 0 && (
          <section>
            <h2 className="mb-1 text-lg font-semibold">{t('dash.otherTests')}</h2>
            <p className="mb-2 text-sm text-slate-600">{t('hub.othersHint')}</p>
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

      {/* Sticky gate to the next step: thumb-reachable on phones. */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-2xl">
          {unlocked ? (
            <Link href={STEP_HOME.done} className="btn-primary w-full">{t('hub.seeMatches')} →</Link>
          ) : (
            <>
              <button type="button" className="btn-primary w-full opacity-50" disabled aria-describedby="hub-gate">
                🔒 {t('hub.seeMatches')}
              </button>
              <p id="hub-gate" className="mt-1 text-center text-xs text-slate-600">
                {t('hub.remaining', { n: required - completed })}
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function SkillRow({ r, t }: { r: SkillOverviewRow; t: (k: string, v?: Record<string, string | number>) => string }) {
  return (
    <li className="card flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate font-medium">{r.name}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {r.score && r.score.public ? (
            <>
              <LevelChip level={r.score.level} label={t(`level.${r.score.level}`)} />
              <BadgeChip badge={r.score.badge} label={t(`badge.${r.score.badge}`)} />
            </>
          ) : r.score ? (
            <LevelChip level="needs_improvement" label={t('level.needs_improvement')} />
          ) : r.testable ? (
            <span className="text-xs text-slate-500">{t('dash.notTested')}</span>
          ) : (
            <span className="text-xs text-slate-500">{t('hub.noTestYet')}</span>
          )}
          {r.kind && <span className="text-xs text-slate-500">· {t(`hub.kind.${r.kind}`)}</span>}
        </div>
      </div>
      {r.testable && r.slug && (
        <Link href={`/test/${r.slug}`} className={r.score ? 'btn-secondary shrink-0 text-sm' : 'btn-primary shrink-0 text-sm'}>
          {r.score ? t('dash.retake') : t('test.start')}
        </Link>
      )}
    </li>
  );
}

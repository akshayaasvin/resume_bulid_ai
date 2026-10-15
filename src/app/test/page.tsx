import Link from 'next/link';
import { AppHeader } from '@/components/AppHeader';
import { BadgeChip, LevelChip } from '@/components/Badges';
import { PendingSubmitter } from '@/components/PendingSubmitter';
import { RunnerStatus } from '@/components/RunnerStatus';
import { PendingTestsWatcher } from '@/components/test/PendingTestsWatcher';
import { pluralKey } from '@/i18n';
import { getT } from '@/i18n/server';
import { requireSession } from '@/lib/auth';
import { skillOverview, type SkillOverviewRow } from '@/lib/candidate-data';
import { skillTestStatuses, type SkillTestStatus } from '@/lib/ai/skill-tests';
import { STEP_HOME, requiredTests } from '@/lib/flow';
import { syncFlowStep, testProgress } from '@/lib/flow-server';
import { canonicalSkillName, normSkill } from '@/lib/skill-alias';

export const dynamic = 'force-dynamic';

/** Skill-test hub: the candidate's declared skills, each with status + start, and the gate to the next step. */
export default async function TestHub() {
  const { supabase, profile } = await requireSession(['candidate']);
  const { t } = getT();
  const [{ rows, others }, step, progress] = await Promise.all([
    skillOverview(supabase, profile.id), syncFlowStep(profile.id), testProgress(profile.id),
  ]);

  const declared = rows.filter((r) => r.claimed);
  const extra = rows.filter((r) => !r.claimed);
  const completed = progress.completedTests;
  const required = requiredTests(progress);
  const unlocked = completed >= required || step === 'done';
  // Declared skills with no test yet: their question bank is generated in the background.
  const untested = declared.filter((r) => !r.testable);
  const statuses = await skillTestStatuses(untested.map((r) => r.name));
  const bankState = (r: SkillOverviewRow): SkillTestStatus['state'] | null =>
    r.testable ? null : statuses.get(normSkill(canonicalSkillName(r.name)))?.state ?? 'pending';
  const watch = untested.filter((r) => bankState(r) !== 'not_testable').map((r) => r.name);
  const kinds = rows.filter((r) => r.slug === 'python' || r.slug === 'sql').map((r) => r.slug as 'python' | 'sql');

  return (
    <>
      <AppHeader signedIn home="/test" />
      <PendingTestsWatcher skills={watch} />
      <main className="mx-auto max-w-2xl space-y-5 px-4 pb-28 pt-5">
        <div>
          <h1 className="text-2xl font-bold">{t('hub.title')}</h1>
          {required > 0 && <p className="mt-1 text-sm text-slate-600">{t(pluralKey('hub.intro', required), { n: required })}</p>}
        </div>
        <PendingSubmitter />

        {required === 0 ? (
          <p role="status" className="card border-brand-100 bg-brand-50 text-sm text-brand-700">{t('hub.fallback')}</p>
        ) : (
          <div className="card">
            <div className="flex items-center justify-between text-sm font-medium">
              <span>{t(pluralKey('hub.progress', required), { done: Math.min(completed, required), total: required })}</span>
              <RunnerStatus kinds={kinds} />
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar"
              aria-valuemin={0} aria-valuemax={required} aria-valuenow={Math.min(completed, required)}>
              <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${Math.min(100, (completed / required) * 100)}%` }} />
            </div>
          </div>
        )}

        <section>
          <h2 className="mb-2 text-lg font-semibold">{t('hub.yourSkills')}</h2>
          {declared.length === 0 ? (
            <div className="card space-y-2 text-sm">
              <p>{t('hub.noSkills')}</p>
              <Link href="/wizard?step=3" className="btn-secondary">{t('hub.addSkills')}</Link>
            </div>
          ) : (
            <ul className="space-y-2">
              {declared.map((r) => <SkillRow key={r.name} r={r} t={t} bank={bankState(r)} />)}
            </ul>
          )}
        </section>

        {extra.length > 0 && (
          <section>
            <h2 className="mb-2 text-lg font-semibold">{t('hub.extraTested')}</h2>
            <ul className="space-y-2">{extra.map((r) => <SkillRow key={r.name} r={r} t={t} bank={null} />)}</ul>
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
                {t(pluralKey('hub.remaining', required - completed), { n: required - completed })}
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function SkillRow({ r, t, bank }: {
  r: SkillOverviewRow; t: (k: string, v?: Record<string, string | number>) => string;
  /** Bank status for a skill without a test yet (null when the skill has a test). */
  bank: SkillTestStatus['state'] | null;
}) {
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
          ) : bank === 'pending' ? (
            <span className="flex items-center gap-1.5 text-xs text-brand-700" role="status">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" aria-hidden />
              {t('hub.bankPending')}
            </span>
          ) : bank === 'failed' ? (
            <span className="text-xs text-slate-500">{t('hub.bankRetrying')}</span>
          ) : bank === 'not_testable' ? (
            <span className="text-xs text-slate-500">{t('hub.notTestable')}</span>
          ) : (
            <span className="text-xs text-slate-500">{t('dash.notTested')}</span>
          )}
          {r.kind && <span className="text-xs text-slate-500">· {t(`hub.kind.${r.kind}`)}</span>}
          {r.ai && <span className="text-xs text-slate-500">· {t('hub.aiBadge')}</span>}
        </div>
      </div>
      {r.testable && r.slug ? (
        <Link href={`/test/${r.slug}`} className={r.score ? 'btn-secondary shrink-0 text-sm' : 'btn-primary shrink-0 text-sm'}>
          {r.score ? t('dash.retake') : t('test.start')}
        </Link>
      ) : null}
    </li>
  );
}

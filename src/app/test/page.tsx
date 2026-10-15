import Link from 'next/link';
import { AppHeader } from '@/components/AppHeader';
import { PendingSubmitter } from '@/components/PendingSubmitter';
import { ClusterCard, type ClusterSkill } from '@/components/test/ClusterCard';
import { PendingTestsWatcher } from '@/components/test/PendingTestsWatcher';
import { pluralKey } from '@/i18n';
import { getT } from '@/i18n/server';
import { requireSession } from '@/lib/auth';
import { skillOverview } from '@/lib/candidate-data';
import { STEP_HOME, reached, requiredTests } from '@/lib/flow';
import { syncFlowStep, testProgress } from '@/lib/flow-server';
import { getConfig } from '@/lib/server-config';
import { VERIFY_NOW_LIMIT, offeredClusters } from '@/lib/tests/clusters';
import { normSkill } from '@/lib/skill-alias';

export const dynamic = 'force-dynamic';

/**
 * Skill-test hub: one combined test per skill group. Up to 3 groups are suggested to verify now,
 * the rest can be verified later; skills without an MCQ test stay Self-declared.
 */
export default async function TestHub() {
  const { supabase, profile } = await requireSession(['candidate']);
  const { t } = getT();
  const [{ rows }, step, progress, testCfg, { data: attempts }] = await Promise.all([
    skillOverview(supabase, profile.id), syncFlowStep(profile.id), testProgress(profile.id), getConfig('test'),
    supabase.from('cluster_attempts').select('cluster_id, status, expires_at').eq('profile_id', profile.id),
  ]);

  const completed = progress.completedTests;
  const required = requiredTests(progress);
  const unlocked = completed >= required || reached(step, 'roles');
  const claimed = rows.filter((r) => r.claimed);
  const { clusters, selfDeclared } = offeredClusters(claimed.map((r) => r.name));
  const row = (name: string) => claimed.find((r) => normSkill(r.name) === normSkill(name));
  const skillState = (name: string): ClusterSkill['state'] => {
    const r = row(name);
    if (r?.score) return r.score.public ? 'verified' : 'practise';
    return r?.testable ? 'ready' : 'pending';
  };
  const open = new Set(((attempts ?? []) as { cluster_id: string; status: string; expires_at: string }[])
    .filter((a) => a.status === 'in_progress' && new Date(a.expires_at).getTime() > Date.now()).map((a) => a.cluster_id));
  const cards = clusters.map((c) => ({ id: c.id, skills: c.skills.map((name) => ({ name, state: skillState(name) })) }));
  // Skills whose question bank is still being built: keep generation going and refresh when ready.
  const watch = cards.flatMap((c) => c.skills.filter((s) => s.state === 'pending').map((s) => s.name));
  const card = (c: (typeof cards)[number]) => (
    <ClusterCard key={c.id} id={c.id} skills={c.skills} inProgress={open.has(c.id)} minutes={testCfg.durationMinutes} t={t} />
  );

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
          <p role="status" className="card border-brand-100 bg-brand-50 text-sm text-brand-700">
            {t(progress.unavailable > 0 ? 'hub.fallback' : 'hub.selfOnly')}
          </p>
        ) : (
          <div className="card">
            <p className="text-sm font-medium">{t(pluralKey('hub.progress', required), { done: Math.min(completed, required), total: required })}</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar"
              aria-valuemin={0} aria-valuemax={required} aria-valuenow={Math.min(completed, required)}>
              <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${Math.min(100, (completed / required) * 100)}%` }} />
            </div>
          </div>
        )}

        {cards.length === 0 && selfDeclared.length === 0 ? (
          <div className="card space-y-2 text-sm">
            <p>{t('hub.noSkills')}</p>
            <Link href="/wizard?step=3" className="btn-secondary">{t('hub.addSkills')}</Link>
          </div>
        ) : null}

        {cards.length > 0 && (
          <section>
            <h2 className="mb-2 text-lg font-semibold">{t('hub.chooseGroups')}</h2>
            <ul className="space-y-3">{cards.slice(0, VERIFY_NOW_LIMIT).map(card)}</ul>
          </section>
        )}

        {cards.length > VERIFY_NOW_LIMIT && (
          <details className="rounded-2xl border border-slate-200 bg-white p-3">
            <summary className="cursor-pointer font-semibold">{t('hub.verifyLater')} ({cards.length - VERIFY_NOW_LIMIT})</summary>
            <p className="mt-1 text-sm text-slate-600">{t('hub.verifyLaterHint')}</p>
            <ul className="mt-3 space-y-3">{cards.slice(VERIFY_NOW_LIMIT).map(card)}</ul>
          </details>
        )}

        {selfDeclared.length > 0 && (
          <section>
            <h2 className="mb-1 text-lg font-semibold">{t('hub.selfDeclared')}</h2>
            <p className="mb-2 text-sm text-slate-600">{t('hub.selfDeclaredHint')}</p>
            <ul className="flex flex-wrap gap-1.5">
              {selfDeclared.map((s) => (
                <li key={s} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700">{s}</li>
              ))}
            </ul>
          </section>
        )}
      </main>

      {/* Sticky gate to the next step: thumb-reachable on phones. */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-2xl">
          {unlocked ? (
            <Link href={STEP_HOME.roles} className="btn-primary w-full">{t('hub.seeMatches')} →</Link>
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

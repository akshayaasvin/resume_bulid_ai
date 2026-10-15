import Link from 'next/link';
import { MAX_SKILLS_PER_CLUSTER } from '@/lib/tests/clusters';

export interface ClusterSkill {
  name: string;
  /** 'verified' (>= threshold), 'practise' (below), 'ready' (testable, not tested), 'pending' (bank being built) */
  state: 'verified' | 'practise' | 'ready' | 'pending';
}

type T = (k: string, v?: Record<string, string | number>) => string;

/** One skill group on the test hub: its selected skills with status, and Start / Continue / Retake. */
export function ClusterCard({ id, skills, inProgress, minutes, t }: {
  id: string; skills: ClusterSkill[]; inProgress: boolean; minutes: number; t: T;
}) {
  const testable = skills.some((s) => s.state !== 'pending');
  const allDone = skills.every((s) => s.state === 'verified' || s.state === 'practise');
  const chip: Record<ClusterSkill['state'], string> = {
    verified: 'border-green-200 bg-green-50 text-green-800',
    practise: 'border-amber-200 bg-amber-50 text-amber-800',
    ready: 'border-slate-300 bg-white text-slate-700',
    pending: 'border-dashed border-slate-300 bg-white text-slate-500',
  };
  const mark: Record<ClusterSkill['state'], string> = { verified: '✓ ', practise: '↻ ', ready: '', pending: '⏳ ' };
  return (
    <li className="card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{t(`cluster.name.${id}`)}</p>
          <p className="text-xs text-slate-500">{t('cluster.meta', { m: minutes })}</p>
        </div>
        {testable ? (
          <Link href={`/test/cluster/${id}`} className={`${allDone && !inProgress ? 'btn-secondary' : 'btn-primary'} shrink-0 text-sm`}>
            {inProgress ? t('cluster.continue') : allDone ? t('dash.retake') : t('test.start')}
          </Link>
        ) : (
          <span className="shrink-0 text-xs text-brand-700" role="status">{t('hub.bankPending')}</span>
        )}
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label={t(`cluster.name.${id}`)}>
        {skills.map((s) => (
          <li key={s.name} className={`rounded-full border px-2.5 py-1 text-xs ${chip[s.state]}`}
            title={t(`cluster.state.${s.state}`)}>
            {mark[s.state]}{s.name}<span className="sr-only"> ({t(`cluster.state.${s.state}`)})</span>
          </li>
        ))}
      </ul>
      {skills.length > MAX_SKILLS_PER_CLUSTER && <p className="text-xs text-slate-500">{t('cluster.maxNote')}</p>}
    </li>
  );
}

'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { getStatus, prefetch, subscribe, type RunnerKind } from '@/lib/runner/client';
import { useT } from '@/i18n/client';

/** Prefetches the given runtimes in the background and shows "Code runner ready ✓". */
export function RunnerStatus({ kinds }: { kinds: RunnerKind[] }) {
  const { t } = useT();
  const key = kinds.join(',');
  useEffect(() => {
    key.split(',').filter(Boolean).forEach((k) => prefetch(k as RunnerKind));
  }, [key]);
  const statuses = useSyncExternalStore(
    subscribe,
    () => kinds.map(getStatus).join(','),
    () => '',
  );
  if (kinds.length === 0) return null;
  const all = statuses.split(',');
  const ready = all.every((s) => s === 'ready');
  const failed = all.some((s) => s === 'error');
  if (failed) return null; // non-blocking: the test page retries on demand
  return (
    <p className={`text-sm ${ready ? 'text-green-700' : 'text-slate-500'}`} aria-live="polite">
      {ready ? t('wizard.runnerReady') : t('wizard.runnerLoading')}
    </p>
  );
}

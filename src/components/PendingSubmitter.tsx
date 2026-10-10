'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useT } from '@/i18n/client';
import { clearAttempt, getPendingSubmits, loadLocalAnswers, submitWithRetry } from '@/lib/test-engine/offline';

/** Flushes test submissions that failed earlier because the network was down. */
export function PendingSubmitter() {
  const { t } = useT();
  const router = useRouter();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const signal = { cancelled: false };
    (async () => {
      const ids = await getPendingSubmits();
      setPending(ids.length);
      for (const id of ids) {
        const answers = await loadLocalAnswers(id);
        if (!answers) { await clearAttempt(id); continue; }
        const r = await submitWithRetry(id, answers, undefined, signal);
        if (r) {
          setPending((n) => Math.max(0, n - 1));
          router.refresh();
        }
      }
    })();
    return () => { signal.cancelled = true; };
  }, [router]);

  if (!pending) return null;
  return <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{t('dash.pendingSubmit')}</p>;
}

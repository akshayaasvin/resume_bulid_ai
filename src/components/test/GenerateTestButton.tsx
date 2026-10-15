'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/i18n/client';

/**
 * "Start test" for a declared skill with no question bank: asks the server to prepare (or fetch the
 * cached) AI-generated test, then opens it. Failures refresh the hub so the fallback can unlock.
 */
export function GenerateTestButton({ skill }: { skill: string }) {
  const { t } = useT();
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function start() {
    setState('loading');
    try {
      const res = await fetch('/api/test/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skill }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.slug) {
        router.push(`/test/${body.slug}`);
        return;
      }
      setMessage(t(res.status === 429 ? 'hub.genRateLimited' : res.status === 422 ? 'hub.notTestable' : 'hub.genFailed'));
    } catch {
      setMessage(t('hub.genOffline'));
    }
    setState('error');
    router.refresh();
  }

  if (state === 'loading') {
    return (
      <span className="flex shrink-0 items-center gap-2 text-sm text-brand-700" role="status" aria-live="polite">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" aria-hidden />
        {t('hub.preparing')}
      </span>
    );
  }
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button type="button" className="btn-primary text-sm" onClick={start}>{t('test.start')}</button>
      {state === 'error' && <p className="max-w-[12rem] text-right text-xs text-red-600" role="alert">{message}</p>}
    </div>
  );
}

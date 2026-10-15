'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

type Status = { state: 'ready' | 'pending' | 'failed' | 'not_testable' };

/**
 * Keeps background bank generation moving for declared skills that have no test yet, and refreshes
 * the hub as soon as one becomes ready (or its status changes). Renders nothing.
 */
export function PendingTestsWatcher({ skills }: { skills: string[] }) {
  const router = useRouter();
  const last = useRef<string>('');
  const key = skills.join('|');

  useEffect(() => {
    if (!skills.length) return;
    let alive = true;
    let delay = 4000;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch('/api/test/prepare', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skills }),
        });
        if (res.ok) {
          const { statuses } = (await res.json()) as { statuses: Record<string, Status | undefined> };
          const sig = JSON.stringify(Object.values(statuses).map((s) => s?.state));
          if (last.current && sig !== last.current) router.refresh(); // something became ready / changed
          last.current = sig;
          if (Object.values(statuses).some((s) => s?.state === 'ready')) router.refresh();
        }
      } catch { /* offline: try again later */ }
      if (!alive) return;
      // Fast at first, then back off; stop after 15 minutes (the page re-arms on next visit).
      delay = Math.min(delay * 1.25, 20000);
      if (Date.now() - started < 15 * 60_000) timer = setTimeout(poll, delay);
    }
    void poll();
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return null;
}

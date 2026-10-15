'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Re-renders the server page every `everyMs` while `active`, for at most `maxMs`. Renders nothing. */
export function RefreshWhile({ active, everyMs, maxMs }: { active: boolean; everyMs: number; maxMs: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const id = setInterval(() => {
      if (Date.now() - started > maxMs) clearInterval(id);
      else router.refresh();
    }, everyMs);
    return () => clearInterval(id);
  }, [active, everyMs, maxMs, router]);
  return null;
}

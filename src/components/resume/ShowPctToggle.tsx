'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/i18n/client';

export function ShowPctToggle({ initial }: { initial: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <span className="text-sm text-slate-700">{t('resume.showPct')}</span>
      <input
        type="checkbox"
        className="h-5 w-5"
        checked={on}
        disabled={busy}
        onChange={async (e) => {
          const next = e.target.checked;
          setOn(next);
          setBusy(true);
          const res = await fetch('/api/profile', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ show_score_pct: next }),
          }).catch(() => null);
          if (!res?.ok) setOn(!next);
          setBusy(false);
          router.refresh();
        }}
      />
    </label>
  );
}

'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/i18n/client';

export interface RoleCard {
  id: string; title: string; matchPct: number;
  skills: string[]; verified: string[]; soft: string[]; goal: string | null;
}

/** Lets the candidate pick one target role; the resume is then tailored to it. */
export function RolePicker({ matches, current }: { matches: RoleCard[]; current: string | null }) {
  const { t } = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch('/api/roles', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role_id: id }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.push('/resume');
      router.refresh();
    } catch {
      setError(t('save.error'));
      setBusy(null);
    }
  }

  return (
    <>
      <ol className="space-y-3">
        {matches.map((m) => (
          <li key={m.id} className={`card ${current === m.id ? 'ring-2 ring-brand-600' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{m.title}</p>
                {current === m.id && <p className="text-xs font-semibold text-brand-700">{t('roles.chosen')}</p>}
              </div>
              <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                {t('ob.value.match', { pct: m.matchPct })}
              </span>
            </div>
            <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
              {m.verified.length > 0 && <li className="text-green-700">✓ {t('ob.reason.verified', { skills: m.verified.join(', ') })}</li>}
              {m.skills.length > 0 && <li>{t('ob.reason.skills', { skills: m.skills.join(', ') })}</li>}
              {m.soft.length > 0 && <li>{t('ob.reason.soft', { skills: m.soft.join(', ') })}</li>}
              {m.goal && <li>{t('ob.reason.goal', { goal: m.goal })}</li>}
            </ul>
            <button type="button" className={`${current === m.id ? 'btn-secondary' : 'btn-primary'} mt-3 w-full`}
              disabled={busy !== null} onClick={() => pick(m.id)}>
              {busy === m.id ? t('common.loading') : current === m.id ? t('roles.continue') : t('roles.pick')}
            </button>
          </li>
        ))}
      </ol>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </>
  );
}

'use client';
import { useState } from 'react';
import { useT } from '@/i18n/client';

/** Turns WhatsApp score updates on or off (profiles.whatsapp_opt_in). */
export function WhatsAppToggle({ initial }: { initial: boolean }) {
  const { t } = useT();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function change(next: boolean) {
    setOn(next);
    setBusy(true);
    setFailed(false);
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ whatsapp_opt_in: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setOn(!next);
      setFailed(true);
    }
    setBusy(false);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm text-slate-700">
          {t('whatsapp.toggle')}
          <span className="block text-xs text-slate-500">{on ? t('whatsapp.on') : t('whatsapp.off')}</span>
        </span>
        <input type="checkbox" className="h-5 w-5 shrink-0" checked={on} disabled={busy} onChange={(e) => change(e.target.checked)} />
      </label>
      {failed && <p className="mt-1 text-xs text-red-600">{t('save.error')}</p>}
    </div>
  );
}

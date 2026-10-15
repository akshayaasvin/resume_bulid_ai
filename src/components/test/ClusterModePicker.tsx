'use client';
import { useState } from 'react';
import { useT } from '@/i18n/client';

/** Workshop students choose campus (PIN) or self mode before a group test, as for per-skill tests. */
export function ClusterModePicker({ busy, error, onStart }: {
  busy: boolean; error: string | null; onStart: (mode: 'campus' | 'self', pin?: string) => void;
}) {
  const { t } = useT();
  const [mode, setMode] = useState<'campus' | 'self'>('campus');
  const [pin, setPin] = useState('');
  return (
    <div className="card space-y-4">
      <p className="font-semibold">{t('test.mode')}</p>
      <div className="grid gap-2">
        {(['campus', 'self'] as const).map((m) => (
          <label key={m} className={`flex items-center gap-3 rounded-xl border p-3 ${mode === m ? 'border-brand-600 bg-brand-50' : 'border-slate-300'}`}>
            <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} className="h-5 w-5" />
            {t(m === 'campus' ? 'test.modeCampus' : 'test.modeSelf')}
          </label>
        ))}
      </div>
      {mode === 'campus' && (
        <div>
          <label className="label" htmlFor="pin">{t('test.pin')}</label>
          <input id="pin" className="input text-center text-2xl tracking-[0.5em]" inputMode="numeric" maxLength={6}
            autoComplete="one-time-code" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        </div>
      )}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button className="btn-primary w-full" disabled={busy || (mode === 'campus' && pin.length < 4)}
        onClick={() => onStart(mode, mode === 'campus' ? pin : undefined)}>
        {busy ? t('common.loading') : t('test.start')}
      </button>
    </div>
  );
}

'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/i18n/client';
import { RunnerStatus } from '../RunnerStatus';

export function TestStart({ skillSlug, skillName, hasWorkshop, openAttemptId }: {
  skillSlug: string; skillName: string; hasWorkshop: boolean; openAttemptId: string | null;
}) {
  const { t, lang } = useT();
  const router = useRouter();
  const [mode, setMode] = useState<'campus' | 'self'>(hasWorkshop ? 'campus' : 'self');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kinds = skillSlug === 'python' ? (['python'] as const) : skillSlug === 'sql' ? (['sql'] as const) : [];

  async function start() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/test/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skill: skillSlug, mode, pin: mode === 'campus' ? pin : undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.error === 'pin_wrong') setError(t('test.pinWrong', { left: body.left ?? 0 }));
        else if (body.error === 'pin_locked') {
          const time = new Date(body.until).toLocaleTimeString(lang === 'ta' ? 'ta-IN' : 'en-IN', { hour: '2-digit', minute: '2-digit' });
          setError(t('test.pinLocked', { time }));
        } else if (body.error === 'no_questions') setError(t('test.noQuestions'));
        else if (body.error === 'no_workshop') setError(t('test.noWorkshop'));
        else setError(t('common.error'));
        setBusy(false);
        return;
      }
      // Fullscreen must be requested from the click itself.
      if (document.fullscreenEnabled && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen().catch(() => undefined);
      }
      router.replace(`/test/${skillSlug}?a=${body.attemptId}`);
    } catch {
      setError(t('common.error'));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <Link href="/test" className="text-sm text-brand-700">← {t('common.back')}</Link>
      <h1 className="mt-3 text-2xl font-bold">{skillName}</h1>
      <p className="mt-2 text-slate-600">{t('test.rules')}</p>
      <div className="mt-3"><RunnerStatus kinds={[...kinds]} /></div>

      {openAttemptId ? (
        <button className="btn-primary mt-6 w-full" onClick={() => router.replace(`/test/${skillSlug}?a=${openAttemptId}`)}>
          {t('test.start')} →
        </button>
      ) : (
        <div className="card mt-6 space-y-4">
          <p className="font-semibold">{t('test.mode')}</p>
          <div className="grid gap-2">
            {hasWorkshop && (
              <label className={`flex items-center gap-3 rounded-xl border p-3 ${mode === 'campus' ? 'border-brand-600 bg-brand-50' : 'border-slate-300'}`}>
                <input type="radio" name="mode" checked={mode === 'campus'} onChange={() => setMode('campus')} className="h-5 w-5" />
                {t('test.modeCampus')}
              </label>
            )}
            <label className={`flex items-center gap-3 rounded-xl border p-3 ${mode === 'self' ? 'border-brand-600 bg-brand-50' : 'border-slate-300'}`}>
              <input type="radio" name="mode" checked={mode === 'self'} onChange={() => setMode('self')} className="h-5 w-5" />
              {t('test.modeSelf')}
            </label>
          </div>
          {mode === 'campus' && (
            <div>
              <label className="label" htmlFor="pin">{t('test.pin')}</label>
              <input id="pin" className="input text-center text-2xl tracking-[0.5em]" inputMode="numeric" maxLength={6}
                autoComplete="one-time-code" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            </div>
          )}
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <button className="btn-primary w-full" disabled={busy || (mode === 'campus' && pin.length < 4)} onClick={start}>
            {busy ? t('common.loading') : t('test.start')}
          </button>
        </div>
      )}
    </main>
  );
}

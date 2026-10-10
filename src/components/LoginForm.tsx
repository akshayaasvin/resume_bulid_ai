'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/i18n/client';

export function LoginForm({ next }: { next?: string }) {
  const { t } = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const phone = String(f.get('phone') ?? '').replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(phone)) {
      setError(t('auth.invalidPhone'));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: `+91${phone}`, password: f.get('password') }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(t(body.error === 'rate_limited' ? 'auth.rateLimited' : 'auth.badCredentials'));
        setBusy(false);
        return;
      }
      // only allow same-site relative redirects
      const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : body.next;
      router.push(dest ?? '/dashboard');
      router.refresh();
    } catch {
      setError(t('common.error'));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="phone">{t('auth.phone')}</label>
        <div className="flex">
          <span className="inline-flex items-center rounded-l-xl border border-r-0 border-slate-300 bg-slate-50 px-3 text-slate-600">+91</span>
          <input className="input rounded-l-none" id="phone" name="phone" required inputMode="numeric" autoComplete="tel-national" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="password">{t('auth.password')}</label>
        <input className="input" id="password" name="password" type="password" required autoComplete="current-password" />
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button className="btn-primary w-full" disabled={busy} type="submit">
        {busy ? t('common.loading') : t('auth.login')}
      </button>
      <p className="text-center text-sm">
        <Link className="text-brand-700 underline" href="/signup">{t('auth.noAccount')}</Link>
      </p>
    </form>
  );
}

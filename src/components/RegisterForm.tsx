'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/i18n/client';

interface Props {
  batch?: { code: string; name: string; college: string };
  colleges?: { id: string; name: string }[];
}

const ERRORS: Record<string, string> = {
  phone_taken: 'auth.phoneTaken',
  invalid_phone: 'auth.invalidPhone',
  invalid_batch: 'auth.invalidBatch',
  rate_limited: 'auth.rateLimited',
};

export function RegisterForm({ batch, colleges = [] }: Props) {
  const { t, lang } = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optIn, setOptIn] = useState(false); // unchecked by default (consent must be explicit)

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
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          full_name: f.get('full_name'),
          name_tamil: f.get('name_tamil') || '',
          phone: `+91${phone}`,
          password: f.get('password'),
          email: f.get('email') || '',
          department: f.get('department') || '',
          year: f.get('year') ? Number(f.get('year')) : undefined,
          college_id: f.get('college_id') || '',
          batch_code: batch?.code ?? '',
          whatsapp_opt_in: optIn,
          language: lang,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(t(ERRORS[body.error] ?? 'common.error'));
        setBusy(false);
        return;
      }
      router.push(body.next ?? '/wizard');
      router.refresh();
    } catch {
      setError(t('common.error'));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {batch && (
        <div className="rounded-xl bg-brand-50 p-3 text-sm text-brand-900">
          <div className="font-semibold">{t('auth.joining')}: {batch.name}</div>
          <div>{batch.college} · {batch.code}</div>
        </div>
      )}
      <div>
        <label className="label" htmlFor="full_name">{t('auth.fullName')}</label>
        <input className="input" id="full_name" name="full_name" required minLength={2} maxLength={100}
          autoComplete="name" pattern="[A-Za-z .'\-]+" title="English letters only" />
      </div>
      <div>
        <label className="label" htmlFor="name_tamil">{t('auth.nameTamil')}</label>
        <input className="input" id="name_tamil" name="name_tamil" maxLength={100} lang="ta" />
      </div>
      <div>
        <label className="label" htmlFor="phone">{t('auth.phone')}</label>
        <div className="flex">
          <span className="inline-flex items-center rounded-l-xl border border-r-0 border-slate-300 bg-slate-50 px-3 text-slate-600">+91</span>
          <input className="input rounded-l-none" id="phone" name="phone" required inputMode="numeric"
            autoComplete="tel-national" placeholder="98XXXXXXXX" maxLength={14} />
        </div>
        <p className="mt-1 text-xs text-slate-500">{t('auth.phoneHint')}</p>
      </div>
      <div>
        <label className="label" htmlFor="password">{t('auth.password')}</label>
        <input className="input" id="password" name="password" type="password" required minLength={6} maxLength={72}
          autoComplete="new-password" />
      </div>
      <div>
        <label className="label" htmlFor="email">{t('auth.email')}</label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" />
      </div>
      {!batch && colleges.length > 0 && (
        <div>
          <label className="label" htmlFor="college_id">{t('auth.college')}</label>
          <select className="input" id="college_id" name="college_id" defaultValue="">
            <option value="">{t('auth.collegeNone')}</option>
            {colleges.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="department">{t('auth.department')}</label>
          <input className="input" id="department" name="department" maxLength={100} placeholder="B.E. CSE" />
        </div>
        <div>
          <label className="label" htmlFor="year">{t('auth.year')}</label>
          <select className="input" id="year" name="year" defaultValue="">
            <option value="">-</option>
            {[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>
      <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <input type="checkbox" className="mt-1 h-5 w-5" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />
        <span className="text-sm text-slate-700">{t('auth.optIn')}</span>
      </label>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button className="btn-primary w-full" disabled={busy} type="submit">
        {busy ? t('common.loading') : t('auth.register')}
      </button>
      <p className="text-center text-sm">
        <Link className="text-brand-700 underline" href="/login">{t('auth.haveAccount')}</Link>
      </p>
    </form>
  );
}

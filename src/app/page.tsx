import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { JoinCodeForm } from '@/components/JoinCodeForm';
import { getT } from '@/i18n/server';
import { getSession } from '@/lib/auth';
import { STEP_HOME } from '@/lib/flow';
import { syncFlowStep } from '@/lib/flow-server';

export default async function Landing() {
  const session = await getSession().catch(() => null);
  if (session) {
    redirect(session.profile.role === 'candidate'
      ? STEP_HOME[await syncFlowStep(session.profile.id)]
      : session.profile.wizard_step < 4 ? '/wizard' : '/dashboard');
  }
  const { t } = getT();
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-8">
        <h1 className="text-3xl font-bold leading-tight text-slate-900">{t('app.tagline')}</h1>
        <ol className="mt-6 space-y-3">
          {['landing.step1', 'landing.step2', 'landing.step3'].map((k, i) => (
            <li key={k} className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700">
                {i + 1}
              </span>
              <span className="text-slate-700">{t(k)}</span>
            </li>
          ))}
        </ol>

        <section className="card mt-8">
          <h2 className="mb-3 text-lg font-semibold">{t('landing.join')}</h2>
          <JoinCodeForm />
        </section>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link href="/signup" className="btn-primary">{t('landing.signup')}</Link>
          <Link href="/login" className="btn-secondary">{t('landing.login')}</Link>
        </div>
      </main>
    </>
  );
}

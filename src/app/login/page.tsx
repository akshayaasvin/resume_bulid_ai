import { AppHeader } from '@/components/AppHeader';
import { LoginForm } from '@/components/LoginForm';
import { getT } from '@/i18n/server';

export default function LoginPage({ searchParams }: { searchParams: { next?: string; registered?: string } }) {
  const { t } = getT();
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-md px-4 pb-16 pt-6">
        <h1 className="mb-4 text-2xl font-bold">{t('auth.login')}</h1>
        {searchParams.registered && (
          <p className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">{t('auth.registeredLogin')}</p>
        )}
        <LoginForm next={searchParams.next} />
      </main>
    </>
  );
}

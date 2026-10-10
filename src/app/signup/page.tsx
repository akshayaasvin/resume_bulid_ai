import { AppHeader } from '@/components/AppHeader';
import { RegisterForm } from '@/components/RegisterForm';
import { getT } from '@/i18n/server';
import { adminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export default async function SignupPage() {
  const { t } = getT();
  const { data: colleges } = await adminClient().from('colleges').select('id, name').order('name');
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-md px-4 pb-16 pt-6">
        <h1 className="mb-4 text-2xl font-bold">{t('landing.signup')}</h1>
        <RegisterForm colleges={(colleges as { id: string; name: string }[] | null) ?? []} />
      </main>
    </>
  );
}

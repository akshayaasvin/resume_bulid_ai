import Link from 'next/link';
import { AppHeader } from '@/components/AppHeader';
import { Onboarding } from '@/components/onboarding/Onboarding';
import { getT } from '@/i18n/server';
import { adminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export default async function JoinPage({ params }: { params: { batch_code: string } }) {
  const { t } = getT();
  const code = decodeURIComponent(params.batch_code).toUpperCase();
  const { data: ws } = await adminClient()
    .from('workshops')
    .select('batch_code, name, is_active, colleges(name)')
    .eq('batch_code', code)
    .maybeSingle<{ batch_code: string; name: string; is_active: boolean; colleges: { name: string } | null }>();

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-md px-4 pb-16 pt-6">
        {ws && ws.is_active ? (
          <Onboarding colleges={[]} batch={{ code: ws.batch_code, name: ws.name, college: ws.colleges?.name ?? '' }} />
        ) : (
          <div className="card space-y-3">
            <p className="text-red-700">{t('auth.invalidBatch')}</p>
            <Link className="btn-secondary w-full" href="/">{t('common.back')}</Link>
          </div>
        )}
      </main>
    </>
  );
}

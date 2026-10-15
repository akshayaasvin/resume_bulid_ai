import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { Onboarding } from '@/components/onboarding/Onboarding';
import { getSession } from '@/lib/auth';
import { STEP_HOME } from '@/lib/flow';
import { syncFlowStep } from '@/lib/flow-server';
import { adminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** Goal-based onboarding: value (matching roles) first, personal details last. */
export default async function SignupPage() {
  const session = await getSession().catch(() => null);
  if (session) redirect(session.profile.role === 'candidate' ? STEP_HOME[await syncFlowStep(session.profile.id)] : '/');
  const { data: colleges } = await adminClient().from('colleges').select('id, name').order('name');
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-md px-4 pt-5">
        <Onboarding colleges={(colleges as { id: string; name: string }[] | null) ?? []} />
      </main>
    </>
  );
}

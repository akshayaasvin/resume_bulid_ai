import { AppHeader } from '@/components/AppHeader';
import { Wizard, type WizardData } from '@/components/wizard/Wizard';
import { requireSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function WizardPage({ searchParams }: { searchParams: { step?: string } }) {
  const { supabase, user, profile } = await requireSession(['candidate']);
  const [{ data: education }, { data: experience }, { data: claimed }, { data: skills }] = await Promise.all([
    supabase.from('education').select('id, institution, degree, field, start_year, end_year, score').eq('profile_id', user.id).order('sort'),
    supabase.from('experience').select('id, type, title, organization, start_date, end_date, description').eq('profile_id', user.id).order('sort'),
    supabase.from('claimed_skills').select('skill_id, name').eq('profile_id', user.id),
    supabase.from('skills').select('id, slug, name, category').eq('is_active', true).order('name'),
  ]);

  const requested = Number(searchParams.step);
  const startStep = requested >= 1 && requested <= 3 ? requested : Math.min(Math.max(profile.wizard_step, 1), 3);

  const initial: WizardData = {
    education: (education ?? []) as WizardData['education'],
    experience: (experience ?? []) as WizardData['experience'],
    skills: (claimed ?? []) as WizardData['skills'],
    summary: profile.summary ?? '',
  };

  return (
    <>
      <AppHeader signedIn home="/dashboard" />
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-4">
        <Wizard
          userId={user.id}
          initial={initial}
          startStep={startStep}
          catalog={(skills ?? []) as { id: string; slug: string; name: string; category: string }[]}
          done={profile.wizard_step >= 4}
        />
      </main>
    </>
  );
}

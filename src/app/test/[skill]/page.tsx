import { notFound } from 'next/navigation';
import { TestStart } from '@/components/test/TestStart';
import { TestRunner } from '@/components/test/TestRunner';
import { requireSession } from '@/lib/auth';
import { resolveMix } from '@/lib/config';
import { getConfig } from '@/lib/server-config';

export const dynamic = 'force-dynamic';

export default async function TestPage({ params, searchParams }: { params: { skill: string }; searchParams: { a?: string } }) {
  const { supabase, profile } = await requireSession(['candidate']);
  const { data: skill } = await supabase.from('skills').select('*').eq('slug', params.skill).eq('is_active', true).maybeSingle();
  if (!skill) notFound();

  if (searchParams.a && /^[0-9a-f-]{36}$/i.test(searchParams.a)) {
    return <TestRunner attemptId={searchParams.a} skillName={skill.name} skillSlug={skill.slug} />;
  }

  // Open attempt for this skill? Offer to resume it.
  const { data: open } = await supabase
    .from('attempts').select('id').eq('profile_id', profile.id).eq('skill_id', skill.id).eq('status', 'in_progress')
    .order('started_at', { ascending: false }).limit(1).maybeSingle();

  const cfg = await getConfig('test');
  const mix = resolveMix(skill.test_mix, cfg.mix);

  return (
    <TestStart
      questionCount={mix.easy + mix.medium + mix.hard}
      minutes={cfg.durationMinutes}
      skillSlug={skill.slug}
      skillName={skill.name}
      hasWorkshop={!!profile.workshop_id}
      openAttemptId={open?.id ?? null}
    />
  );
}

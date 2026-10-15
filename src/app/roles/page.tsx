import Link from 'next/link';
import { AppHeader } from '@/components/AppHeader';
import { RolePicker } from '@/components/roles/RolePicker';
import { getT } from '@/i18n/server';
import { requireSession } from '@/lib/auth';
import { skillOverview } from '@/lib/candidate-data';
import type { Goal, Level } from '@/lib/onboarding/catalog';
import { matchRoles } from '@/lib/onboarding/roles';

export const dynamic = 'force-dynamic';

/** Job matches from goal + declared skills + verified test scores; the candidate picks a target role. */
export default async function RolesPage() {
  const { supabase, profile } = await requireSession(['candidate']);
  const { t } = getT();
  const p = profile as typeof profile & {
    goal?: Goal | null; english_level?: Level | null; soft_skills?: string[] | null; target_role_id?: string | null;
  };
  const { rows } = await skillOverview(supabase, profile.id);
  // Only publicly shown scores (>= the beginner threshold) count as verified, as on the resume.
  const verified = Object.fromEntries(rows.filter((r) => r.score?.public).map((r) => [r.name, r.score!.pct]));
  const matches = matchRoles({
    goal: p.goal ?? null,
    englishLevel: p.english_level ?? null,
    softSkills: p.soft_skills ?? [],
    techSkills: rows.filter((r) => r.claimed).map((r) => r.name),
    verified,
  }, 5);

  return (
    <>
      <AppHeader signedIn home="/roles" />
      <main className="mx-auto max-w-2xl space-y-4 px-4 pb-16 pt-5">
        <div>
          <h1 className="text-2xl font-bold">{t('roles.title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('roles.intro')}</p>
        </div>
        {matches.length === 0 ? (
          <div className="card space-y-3 text-sm">
            <p>{t('roles.none')}</p>
            <Link href="/test" className="btn-secondary w-full">{t('hub.backToTests')}</Link>
          </div>
        ) : (
          <RolePicker
            current={p.target_role_id ?? null}
            matches={matches.map((m) => ({
              id: m.role.id, title: m.role.title, matchPct: m.matchPct,
              skills: m.skills.filter((s) => !m.verifiedSkills.includes(s)), verified: m.verifiedSkills,
              soft: m.soft.map((s) => t(`ob.softName.${s}`)),
              goal: m.goalFit && p.goal && p.goal !== 'not_sure' ? t(`ob.goal.${p.goal}`) : null,
            }))}
          />
        )}
        <Link href="/wizard?step=2" className="block text-center text-sm text-brand-700 underline">{t('roles.addMore')}</Link>
      </main>
    </>
  );
}

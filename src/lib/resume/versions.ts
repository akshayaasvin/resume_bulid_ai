import 'server-only';
import { waitUntil } from '@vercel/functions';
import { adminClient } from '../supabase/admin';
import { getConfig } from '../server-config';
import { roleById, type JobRole } from '../onboarding/roles';
import { tailorWithAI } from '../ai/resume-tailor';
import { buildSnapshot, type ResumeSnapshot, type SnapshotInput } from './snapshot';
import { applyTailoring, deterministicTailoring, sanitizeTailoring, type Tailoring } from './tailor';
import { recommendTemplate, isTemplateId } from './templates';

export async function loadSnapshotInput(profileId: string): Promise<SnapshotInput | null> {
  const db = adminClient();
  const [{ data: profile }, { data: extras }, { data: education }, { data: experience }, { data: claimed }, { data: scores }, { data: awards }] = await Promise.all([
    db.from('profiles').select('full_name, name_tamil, phone_whatsapp, email, department, year, summary, colleges(name)').eq('id', profileId).single(),
    // onboarding columns (migration 0009); missing columns just mean no extras
    db.from('profiles').select('*').eq('id', profileId).maybeSingle(),
    db.from('education').select('institution, degree, field, start_year, end_year, score, sort').eq('profile_id', profileId),
    db.from('experience').select('type, title, organization, start_date, end_date, bullets, description, sort').eq('profile_id', profileId),
    db.from('claimed_skills').select('skill_id, name').eq('profile_id', profileId),
    db.from('skill_scores').select('skill_id, score_pct, level, badge, skills(name)').eq('profile_id', profileId),
    db.from('awards').select('name, issuer, year, sort').eq('profile_id', profileId),
  ]);
  if (!profile) return null;
  const college = (profile as unknown as { colleges: { name: string } | null }).colleges?.name ?? null;
  return {
    profile: {
      ...(profile as SnapshotInput['profile']),
      ...(() => {
        const x = (extras ?? {}) as Partial<SnapshotInput['profile']>;
        return { soft_skills: x.soft_skills, english_level: x.english_level, tamil_level: x.tamil_level, languages: x.languages };
      })(),
    },
    college,
    education: (education ?? []) as SnapshotInput['education'],
    experience: (experience ?? []) as SnapshotInput['experience'],
    claimed: (claimed ?? []) as SnapshotInput['claimed'],
    awards: (awards ?? []) as NonNullable<SnapshotInput['awards']>,
    scores: ((scores ?? []) as unknown as { skill_id: string; score_pct: number; level: never; badge: never; skills: { name: string } | null }[]).map((s) => ({
      skill_id: s.skill_id,
      skill_name: s.skills?.name ?? '',
      score_pct: Number(s.score_pct),
      level: s.level,
      badge: s.badge,
    })),
  };
}

/** The candidate's target role and any saved AI tailoring for it. */
async function roleAndTailoring(profileId: string): Promise<{ role: JobRole | null; ai: Tailoring | null; aiRaw: unknown }> {
  const db = adminClient();
  const { data: p } = await db.from('profiles').select('target_role_id').eq('id', profileId).maybeSingle();
  const role = p?.target_role_id ? roleById(p.target_role_id as string) : null;
  if (!role) return { role: null, ai: null, aiRaw: null };
  const { data: t } = await db.from('resume_tailoring').select('role_id, status, result').eq('profile_id', profileId).maybeSingle();
  const aiRaw = t && t.role_id === role.id && t.status === 'ready' ? t.result : null;
  return { role, ai: null, aiRaw };
}

/** Builds the snapshot for a new version: data -> role tailoring (AI if available, else rules). */
async function tailoredSnapshot(profileId: string): Promise<{ snapshot: ResumeSnapshot; role: JobRole | null } | null> {
  const input = await loadSnapshotInput(profileId);
  if (!input) return null;
  const base = buildSnapshot(input, await getConfig('scoring'));
  const { role, aiRaw } = await roleAndTailoring(profileId);
  if (!role) return { snapshot: base, role: null };
  // Re-sanitise the saved AI result against today's data (new skills, edited projects).
  const ai = aiRaw ? sanitizeTailoring(aiRaw as Parameters<typeof sanitizeTailoring>[0], base) : null;
  const rules = deterministicTailoring(base, role);
  const tailoring: Tailoring = ai
    ? {
      summary: ai.summary ?? rules.summary,
      skillOrder: ai.skillOrder.length ? ai.skillOrder : rules.skillOrder,
      experience: ai.experience.length ? ai.experience : rules.experience,
    }
    : rules;
  return { snapshot: applyTailoring(base, tailoring, role), role };
}

/** Creates the next resume version from current data. Returns the new version number. */
export async function createResumeVersion(profileId: string, kind: 'initial' | 'verified' | 'tailored'): Promise<number | null> {
  const db = adminClient();
  const built = await tailoredSnapshot(profileId);
  if (!built) return null;

  // Keep the template the candidate chose last; otherwise recommend one for the role.
  const { data: last } = await db.from('resumes').select('*').eq('profile_id', profileId)
    .order('version', { ascending: false }).limit(1).maybeSingle();
  const lastTemplate = (last as { template_id?: string } | null)?.template_id;
  const template_id = isTemplateId(lastTemplate) && kind !== 'tailored' ? lastTemplate : recommendTemplate(built.role?.id);

  // Retry on the (profile_id, version) unique constraint if two submits race.
  for (let i = 0; i < 3; i++) {
    const { data: top } = await db
      .from('resumes').select('version').eq('profile_id', profileId)
      .order('version', { ascending: false }).limit(1).maybeSingle();
    const version = (top?.version ?? 0) + 1;
    const row = { profile_id: profileId, version, kind, snapshot: built.snapshot, template_id };
    let { error } = await db.from('resumes').insert(row);
    if (error?.code === '42703' || error?.code === '22P02') {
      // template_id column / 'tailored' kind missing (migration 0010 not applied yet)
      ({ error } = await db.from('resumes').insert({ profile_id: profileId, version, kind: kind === 'tailored' ? 'verified' : kind, snapshot: built.snapshot }));
    }
    if (!error) return version;
    if (error.code !== '23505') throw error;
  }
  return null;
}

/**
 * After the candidate picks a target role: tailor with AI in the background, then create a
 * 'tailored' version. Without an API key the rule-based version is created right away.
 */
export async function startRoleTailoring(profileId: string, role: JobRole): Promise<'pending' | 'done'> {
  const db = adminClient();
  if (!process.env.ANTHROPIC_API_KEY) {
    await createResumeVersion(profileId, 'tailored');
    return 'done';
  }
  await db.from('resume_tailoring').upsert({ profile_id: profileId, role_id: role.id, status: 'pending', result: null, updated_at: new Date().toISOString() });
  waitUntil((async () => {
    try {
      const input = await loadSnapshotInput(profileId);
      const base = input ? buildSnapshot(input, await getConfig('scoring')) : null;
      const ai = base ? await tailorWithAI(base, role, profileId) : null;
      await db.from('resume_tailoring').update({
        status: ai ? 'ready' : 'failed',
        result: ai ? { summary: ai.summary, skill_order: ai.skillOrder, experience: ai.experience } : null,
        updated_at: new Date().toISOString(),
      }).eq('profile_id', profileId).eq('role_id', role.id);
    } catch (e) {
      console.error('role tailoring crashed', e instanceof Error ? e.message : 'unknown');
    }
    // Always produce the tailored version (rule-based if AI failed) so the candidate isn't left waiting.
    await createResumeVersion(profileId, 'tailored').catch((e) => console.error('tailored version failed', e));
  })());
  return 'pending';
}

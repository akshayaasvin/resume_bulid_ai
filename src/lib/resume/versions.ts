import 'server-only';
import { adminClient } from '../supabase/admin';
import { getConfig } from '../server-config';
import { buildSnapshot, type ResumeSnapshot, type SnapshotInput } from './snapshot';

export async function loadSnapshotInput(profileId: string): Promise<SnapshotInput | null> {
  const db = adminClient();
  const [{ data: profile }, { data: education }, { data: experience }, { data: claimed }, { data: scores }, { data: awards }] = await Promise.all([
    db.from('profiles').select('full_name, name_tamil, phone_whatsapp, email, department, year, summary, colleges(name)').eq('id', profileId).single(),
    db.from('education').select('institution, degree, field, start_year, end_year, score, sort').eq('profile_id', profileId),
    db.from('experience').select('type, title, organization, start_date, end_date, bullets, description, sort').eq('profile_id', profileId),
    db.from('claimed_skills').select('skill_id, name').eq('profile_id', profileId),
    db.from('skill_scores').select('skill_id, score_pct, level, badge, skills(name)').eq('profile_id', profileId),
    db.from('awards').select('name, issuer, year, sort').eq('profile_id', profileId),
  ]);
  if (!profile) return null;
  const college = (profile as unknown as { colleges: { name: string } | null }).colleges?.name ?? null;
  return {
    profile: profile as SnapshotInput['profile'],
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

/** Creates the next resume version from current data. Returns the new version number. */
export async function createResumeVersion(profileId: string, kind: 'initial' | 'verified'): Promise<number | null> {
  const db = adminClient();
  const input = await loadSnapshotInput(profileId);
  if (!input) return null;
  const snapshot: ResumeSnapshot = buildSnapshot(input, await getConfig('scoring'));

  // Retry on the (profile_id, version) unique constraint if two submits race.
  for (let i = 0; i < 3; i++) {
    const { data: last } = await db
      .from('resumes').select('version').eq('profile_id', profileId)
      .order('version', { ascending: false }).limit(1).maybeSingle();
    const version = (last?.version ?? 0) + 1;
    const { error } = await db.from('resumes').insert({ profile_id: profileId, version, kind, snapshot });
    if (!error) return version;
    if (error.code !== '23505') throw error;
  }
  return null;
}

import type { ScoringConfig } from '../config';
import { isPublicScore, type Badge, type SkillLevel } from '../scoring';

export interface ResumeSnapshot {
  name: string;
  nameTamil: string | null;
  /** Target role shown under the name (role-based resumes). Absent on older snapshots. */
  headline?: string | null;
  phone: string | null;
  email: string | null;
  college: string | null;
  department: string | null;
  year: number | null;
  summary: string | null;
  education: { institution: string; degree: string; field: string | null; years: string; score: string | null }[];
  experience: { type: 'internship' | 'job' | 'project'; title: string; organization: string | null; period: string; bullets: string[] }[];
  verifiedSkills: { name: string; level: SkillLevel; badge: Badge; scorePct: number }[];
  otherSkills: string[];
  /** Awards & certificates. Absent on older snapshots. */
  awards?: { name: string; issuer: string | null; year: number | null }[];
  /** Soft skills from onboarding ("Strengths"). Absent on older snapshots. */
  softSkills?: string[];
  /** Spoken languages from onboarding. Absent on older snapshots. */
  languages?: { name: string; level: string }[];
  generatedAt: string;
}

export interface SnapshotInput {
  profile: {
    full_name: string; name_tamil: string | null; phone_whatsapp: string | null; email: string | null;
    department: string | null; year: number | null; summary: string | null;
    soft_skills?: string[] | null; english_level?: string | null; tamil_level?: string | null;
  };
  college: string | null;
  education: { institution: string; degree: string; field: string | null; start_year: number | null; end_year: number | null; score: string | null; sort: number }[];
  experience: { type: 'internship' | 'job' | 'project'; title: string; organization: string | null; start_date: string | null; end_date: string | null; bullets: string[]; description: string | null; sort: number }[];
  claimed: { skill_id: string | null; name: string }[];
  scores: { skill_id: string; skill_name: string; score_pct: number; level: SkillLevel; badge: Badge }[];
  awards?: { name: string; issuer: string | null; year: number | null; sort: number }[];
}

const sameText = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Lines under the name in the resume header. Anything that just repeats the name is dropped,
 * so a candidate who typed their English name into the Tamil-name field doesn't see it twice.
 */
export function headerLines(s: Pick<ResumeSnapshot, 'name' | 'nameTamil' | 'headline'>) {
  const keep = (v: string | null | undefined) => (v && v.trim() && !sameText(v, s.name) ? v.trim() : null);
  const headline = keep(s.headline);
  const nameTamil = keep(s.nameTamil);
  return { headline, nameTamil: nameTamil && headline && sameText(nameTamil, headline) ? null : nameTamil };
}

const LANG_LEVEL: Record<string, string> = { basic: 'Basic', intermediate: 'Intermediate', fluent: 'Fluent' };

const BADGE_ORDER: Record<Badge, number> = { campus_verified: 0, verified: 1, self: 2 };

/**
 * Builds what the resume shows. Scores below the beginner threshold are dropped entirely:
 * not listed as verified, and the skill is also removed from "other skills" (no hint of a fail).
 */
export function buildSnapshot(input: SnapshotInput, cfg: ScoringConfig, now = new Date()): ResumeSnapshot {
  const publicScores = input.scores.filter((s) => isPublicScore(Number(s.score_pct), cfg));
  const testedIds = new Set(input.scores.map((s) => s.skill_id));
  const testedNames = new Set(input.scores.map((s) => s.skill_name.toLowerCase()));

  const verifiedSkills = publicScores
    .map((s) => ({ name: s.skill_name, level: s.level, badge: s.badge, scorePct: Number(s.score_pct) }))
    .sort((a, b) => BADGE_ORDER[a.badge] - BADGE_ORDER[b.badge] || b.scorePct - a.scorePct);

  const otherSkills = input.claimed
    .filter((c) => !(c.skill_id && testedIds.has(c.skill_id)) && !testedNames.has(c.name.toLowerCase()))
    .map((c) => c.name);

  const period = (a: string | null, b: string | null) => [a, b].filter(Boolean).join(' – ');

  return {
    name: input.profile.full_name,
    nameTamil: input.profile.name_tamil,
    phone: input.profile.phone_whatsapp,
    email: input.profile.email,
    college: input.college,
    department: input.profile.department,
    year: input.profile.year,
    summary: input.profile.summary,
    education: [...input.education]
      .sort((a, b) => a.sort - b.sort)
      .map((e) => ({
        institution: e.institution,
        degree: e.degree,
        field: e.field,
        years: period(e.start_year?.toString() ?? null, e.end_year?.toString() ?? null),
        score: e.score,
      })),
    experience: [...input.experience]
      .sort((a, b) => a.sort - b.sort)
      .map((x) => ({
        type: x.type,
        title: x.title,
        organization: x.organization,
        period: period(x.start_date, x.end_date),
        bullets: x.bullets.length ? x.bullets : (x.description ?? '').split('\n').map((s) => s.trim()).filter(Boolean),
      })),
    verifiedSkills,
    otherSkills,
    awards: [...(input.awards ?? [])].sort((a, b) => a.sort - b.sort).map(({ name, issuer, year }) => ({ name, issuer, year })),
    softSkills: input.profile.soft_skills ?? [],
    languages: [
      ...(input.profile.english_level ? [{ name: 'English', level: LANG_LEVEL[input.profile.english_level] ?? input.profile.english_level }] : []),
      ...(input.profile.tamil_level ? [{ name: 'Tamil', level: LANG_LEVEL[input.profile.tamil_level] ?? input.profile.tamil_level }] : []),
    ],
    generatedAt: now.toISOString(),
  };
}

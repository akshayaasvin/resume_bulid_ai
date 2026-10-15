import { canonicalSkillName, normSkill } from '../skill-alias';
import type { JobRole } from '../onboarding/roles';
import type { ResumeSnapshot } from './snapshot';

/**
 * Role tailoring for a resume: summary, skills in order of relevance, most relevant projects /
 * experience first (optionally with tightened bullet wording). Uses only the candidate's own data.
 */
export interface Tailoring {
  summary: string | null;
  skillOrder: string[];
  /** Experience/projects by title, most relevant first; bullets replace the originals when given. */
  experience: { title: string; bullets?: string[] }[];
}

const key = (s: string) => normSkill(canonicalSkillName(s));
const lc = (s: string) => s.trim().toLowerCase();

function relevance(skill: string, role: JobRole): number {
  const k = key(skill);
  if (role.core.some((c) => key(c) === k)) return 3;
  if (role.helpful.some((c) => key(c) === k)) return 1;
  return 0;
}

function experienceRelevance(x: ResumeSnapshot['experience'][number], role: JobRole): number {
  const text = lc([x.title, x.organization ?? '', ...x.bullets].join(' '));
  let score = 0;
  for (const s of [...role.core, ...role.helpful]) {
    const word = lc(s).replace(/[^a-z0-9+#/ ]/g, '');
    if (word && text.includes(word)) score += role.core.includes(s) ? 3 : 1;
  }
  return score + (x.type === 'internship' || x.type === 'job' ? 1 : 0);
}

/** Rule-based tailoring (no AI): always available, never invents anything. */
export function deterministicTailoring(s: ResumeSnapshot, role: JobRole): Tailoring {
  const skills = [...s.verifiedSkills.map((v) => v.name), ...s.otherSkills];
  const verifiedFirst = new Set(s.verifiedSkills.map((v) => v.name));
  const skillOrder = [...skills].sort((a, b) =>
    relevance(b, role) - relevance(a, role) || Number(verifiedFirst.has(b)) - Number(verifiedFirst.has(a)));
  const experience = [...s.experience]
    .map((x, i) => ({ x, i, r: experienceRelevance(x, role) }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map(({ x }) => ({ title: x.title }));

  let summary = s.summary;
  if (!summary) {
    const edu = s.education[0];
    const parts: string[] = [];
    const eduText = edu ? `${edu.degree}${edu.field ? ` (${edu.field})` : ''} from ${edu.institution}` : null;
    parts.push(eduText ? `${eduText}, looking for a ${role.title} role.` : `Looking for a ${role.title} role.`);
    const verified = skillOrder.filter((n) => verifiedFirst.has(n)).slice(0, 3);
    if (verified.length) parts.push(`Skills verified by assessment: ${verified.join(', ')}.`);
    const other = skillOrder.filter((n) => !verifiedFirst.has(n)).slice(0, 4);
    if (other.length) parts.push(`Also skilled in ${other.join(', ')}.`);
    if (s.softSkills?.length) parts.push(`Strengths: ${s.softSkills.slice(0, 3).join(', ').toLowerCase()}.`);
    summary = parts.join(' ');
  }
  return { summary, skillOrder, experience };
}

/** Digit groups in a text ("2024", "8.5" -> "8", "5"). Used to stop invented numbers. */
const numbers = (t: string) => new Set(t.match(/\d+/g) ?? []);
const onlyKnownNumbers = (text: string, known: Set<string>) => [...numbers(text)].every((n) => known.has(n));

/**
 * Keeps only what is safe from an AI tailoring: skills the candidate has, experience items that
 * exist, and wording that adds no numbers (dates, marks, counts) that aren't in their own data.
 */
export function sanitizeTailoring(
  ai: { summary?: string; skill_order?: string[]; experience?: { title: string; bullets?: string[] }[] },
  s: ResumeSnapshot,
): Tailoring {
  const allText = JSON.stringify({ e: s.education, x: s.experience, a: s.awards, v: s.verifiedSkills.map((v) => v.name), o: s.otherSkills, c: s.college });
  const known = numbers(allText);
  const skills = [...s.verifiedSkills.map((v) => v.name), ...s.otherSkills];
  const byKey = new Map(skills.map((n) => [key(n), n]));
  const skillOrder = Array.from(new Set((ai.skill_order ?? []).map((n) => byKey.get(key(n))).filter((n): n is string => !!n)));

  const summary = ai.summary?.trim();
  const safeSummary = summary && summary.length >= 40 && summary.length <= 600 && onlyKnownNumbers(summary, known) ? summary : null;

  const seen = new Set<string>();
  const experience = (ai.experience ?? []).flatMap((item) => {
    const orig = s.experience.find((x) => lc(x.title) === lc(item.title ?? ''));
    if (!orig || seen.has(lc(orig.title))) return [];
    seen.add(lc(orig.title));
    const itemNumbers = numbers(JSON.stringify(orig));
    const bullets = (item.bullets ?? [])
      .map((b) => b.trim())
      .filter((b) => b.length > 0 && b.length <= 200 && onlyKnownNumbers(b, itemNumbers))
      .slice(0, 4);
    return [{ title: orig.title, ...(bullets.length ? { bullets } : {}) }];
  });
  return { summary: safeSummary, skillOrder, experience };
}

function orderBy<T>(list: T[], name: (t: T) => string, order: string[]): T[] {
  const pos = new Map(order.map((n, i) => [key(n), i]));
  return list
    .map((v, i) => ({ v, i, p: pos.get(key(name(v))) ?? order.length + i }))
    .sort((a, b) => a.p - b.p)
    .map(({ v }) => v);
}

/** Applies a tailoring (AI-sanitised or rule-based) on top of a built snapshot. */
export function applyTailoring(s: ResumeSnapshot, t: Tailoring | null, role: Pick<JobRole, 'title'> | null): ResumeSnapshot {
  if (!role) return s;
  const out: ResumeSnapshot = { ...s, headline: role.title };
  if (!t) return out;
  out.summary = t.summary ?? s.summary;
  out.verifiedSkills = orderBy(s.verifiedSkills, (v) => v.name, t.skillOrder);
  out.otherSkills = orderBy(s.otherSkills, (n) => n, t.skillOrder);
  const exp = orderBy(s.experience, (x) => x.title, t.experience.map((e) => e.title));
  out.experience = exp.map((x) => {
    const b = t.experience.find((e) => lc(e.title) === lc(x.title))?.bullets;
    return b?.length ? { ...x, bullets: b } : x;
  });
  return out;
}

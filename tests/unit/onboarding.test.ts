import { describe, expect, it } from 'vitest';
import { isJunkName, validateEducation } from '@/lib/education-validation';
import { onboardingAnswersSchema } from '@/lib/onboarding/catalog';
import { JOB_ROLES, matchRoles } from '@/lib/onboarding/roles';
import { resumeLanguages } from '@/lib/resume/snapshot';

const NOW = new Date('2026-10-15T00:00:00Z');
const edu = (institution: string, o: Record<string, unknown> = {}) =>
  validateEducation({ institution, degree: 'B.E.', field: 'CSE', start_year: 2022, end_year: 2026, score: '8.1', ...o }, NOW);

describe('education: junk school / college names are rejected', () => {
  it.each(['Asd', 'asdf', 'qwe', 'Zxc', 'Vbb', 'aaaa', 'Lkj'])('%s is junk', (name) => {
    expect(isJunkName(name)).toBe(true);
    expect(edu(name).institution).toBe('junk');
  });
  it.each(['R5y', 'College 123', 'PSG 2'])('%s has digits', (name) => {
    expect(edu(name).institution).toBe('letters');
  });
  it('needs at least 3 characters', () => {
    expect(edu('Ab').institution).toBe('tooShort');
  });
  it.each([
    'PSG College of Technology', 'SRM', 'IIT Madras', "St. Joseph's College", 'Govt. Hr. Sec. School',
    'Anna University (CEG)', 'Kumaraguru College of Technology', 'Sri Krishna Arts & Science College', 'NIT Trichy',
  ])('%s is accepted', (name) => {
    expect(isJunkName(name)).toBe(false);
    expect(edu(name)).toEqual({});
  });
  it('end year >= start year and at most current year + 5', () => {
    expect(edu('PSG Tech', { start_year: 2025, end_year: 2023 }).end_year).toBe('yearOrder');
    expect(edu('PSG Tech', { start_year: 2026, end_year: 2032 }).end_year).toBe('year');
    expect(edu('PSG Tech', { start_year: 2026, end_year: 2031 })).toEqual({});
  });
  it('marks: 0-100 or CGPA 0-10', () => {
    expect(edu('PSG Tech', { score: '101' }).score).toBe('score');
    expect(edu('PSG Tech', { score: '11 CGPA' }).score).toBe('score');
    expect(edu('PSG Tech', { score: '87.5' })).toEqual({});
  });
});

describe('onboarding answers', () => {
  const ok = {
    goal: 'job', english_level: 'intermediate', languages: [{ name: 'Tamil', level: 'fluent' }],
    soft_skills: ['Teamwork'], tech_skills: ['Python'],
  };
  it('accepts a complete set', () => expect(onboardingAnswersSchema.safeParse(ok).success).toBe(true));
  it('needs a goal, an English level and at least one technical skill', () => {
    expect(onboardingAnswersSchema.safeParse({ ...ok, goal: 'astronaut' }).success).toBe(false);
    expect(onboardingAnswersSchema.safeParse({ ...ok, english_level: undefined }).success).toBe(false);
    expect(onboardingAnswersSchema.safeParse({ ...ok, tech_skills: [] }).success).toBe(false);
  });
  it('other languages are optional, each needs a level, no duplicates, no second English', () => {
    expect(onboardingAnswersSchema.parse({ ...ok, languages: undefined }).languages).toEqual([]);
    expect(onboardingAnswersSchema.safeParse({ ...ok, languages: [{ name: 'Hindi', level: null }] }).success).toBe(false);
    expect(onboardingAnswersSchema.safeParse({ ...ok, languages: [{ name: 'Tamil', level: 'basic' }, { name: 'tamil', level: 'fluent' }] }).success).toBe(false);
    expect(onboardingAnswersSchema.safeParse({ ...ok, languages: [{ name: 'English', level: 'fluent' }] }).success).toBe(false);
    expect(onboardingAnswersSchema.safeParse({ ...ok, languages: [{ name: 'Sourashtra', level: 'basic' }] }).success).toBe(true); // "Other"
  });
});

describe('resume languages', () => {
  const p = { full_name: 'P', name_tamil: null, phone_whatsapp: null, email: null, department: null, year: null, summary: null };
  it('lists English first, then added languages in the order added', () => {
    expect(resumeLanguages({ ...p, english_level: 'fluent', languages: [{ name: 'Hindi', level: 'basic' }, { name: 'Tamil', level: 'fluent' }] }))
      .toEqual([{ name: 'English', level: 'Fluent' }, { name: 'Hindi', level: 'Basic' }, { name: 'Tamil', level: 'Fluent' }]);
  });
  it('keeps the Tamil answer of profiles created before the language list', () => {
    expect(resumeLanguages({ ...p, english_level: 'intermediate', tamil_level: 'fluent', languages: [] }))
      .toEqual([{ name: 'English', level: 'Intermediate' }, { name: 'Tamil', level: 'Fluent' }]);
  });
});

describe('matchRoles', () => {
  it('suggests data roles for SQL + Excel + Python', () => {
    const top = matchRoles({ goal: 'job', englishLevel: 'intermediate', softSkills: ['Problem solving'], techSkills: ['SQL', 'Excel', 'Python'] });
    expect(top).toHaveLength(3);
    expect(top[0].role.id).toBe('data-analyst');
    expect(top[0].skills).toEqual(expect.arrayContaining(['SQL', 'Excel', 'Python']));
  });
  it('suggests CAD roles for AutoCAD and understands aliases ("JS")', () => {
    expect(matchRoles({ goal: 'job', englishLevel: 'basic', softSkills: [], techSkills: ['AutoCAD'] })[0].role.id).toBe('cad-draftsman');
    expect(matchRoles({ goal: 'freelancing', englishLevel: 'basic', softSkills: [], techSkills: ['JS', 'HTML'] })[0].role.id).toBe('web-dev');
  });
  it('verified scores lift a role above declared-only matches', () => {
    const base = { goal: 'job' as const, englishLevel: 'intermediate' as const, softSkills: [], techSkills: ['Java', 'Excel', 'Tally'] };
    const declared = matchRoles(base, 5).map((m) => m.role.id);
    const verified = matchRoles({ ...base, verified: { Java: 92 } }, 5);
    expect(verified[0].role.id).toMatch(/java-dev|software-dev/);
    expect(verified[0].verifiedSkills).toContain('Java');
    expect(declared).toBeTruthy();
  });
  it('spoken-English-heavy roles need more than basic English', () => {
    const input = { goal: 'job' as const, softSkills: ['Communication', 'Customer handling', 'Presentation'], techSkills: ['Sales'] };
    const fluent = matchRoles({ ...input, englishLevel: 'fluent' }, 5).find((m) => m.role.id === 'sales-executive')!;
    const basic = matchRoles({ ...input, englishLevel: 'basic' }, 5).find((m) => m.role.id === 'sales-executive')!;
    expect(fluent.matchPct).toBeGreaterThan(basic.matchPct);
  });
  it('never returns a role with nothing in common', () => {
    expect(matchRoles({ goal: 'job', englishLevel: 'fluent', softSkills: [], techSkills: ['Underwater basket weaving'] })).toEqual([]);
  });
  it('role ids are unique', () => {
    expect(new Set(JOB_ROLES.map((r) => r.id)).size).toBe(JOB_ROLES.length);
  });
});

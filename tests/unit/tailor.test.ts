import { describe, expect, it } from 'vitest';
import { roleById } from '@/lib/onboarding/roles';
import type { ResumeSnapshot } from '@/lib/resume/snapshot';
import { applyTailoring, deterministicTailoring, sanitizeTailoring } from '@/lib/resume/tailor';

const dataAnalyst = roleById('data-analyst')!;

const snap = (o: Partial<ResumeSnapshot> = {}): ResumeSnapshot => ({
  name: 'Priya S', nameTamil: null, phone: null, email: null, college: 'PSG Tech', department: 'CSE', year: 3,
  summary: null,
  education: [{ institution: 'PSG College of Technology', degree: 'B.E.', field: 'CSE', years: '2022 – 2026', score: '8.4' }],
  experience: [
    { type: 'project', title: 'Library app', organization: null, period: '', bullets: ['Built search for 500 books'] },
    { type: 'project', title: 'Sales dashboard', organization: null, period: '', bullets: ['Cleaned data in Excel', 'Wrote SQL reports'] },
  ],
  verifiedSkills: [
    { name: 'Canva', level: 'advanced', badge: 'verified', scorePct: 90 },
    { name: 'SQL', level: 'intermediate', badge: 'self', scorePct: 70 },
  ],
  otherSkills: ['Photoshop', 'Excel'],
  softSkills: ['Problem solving', 'Teamwork'],
  generatedAt: '2026-10-01T00:00:00.000Z',
  ...o,
});

describe('deterministicTailoring', () => {
  it('orders skills by relevance to the role (core first, verified breaks ties)', () => {
    const t = deterministicTailoring(snap(), dataAnalyst);
    expect(t.skillOrder.slice(0, 2)).toEqual(['SQL', 'Excel']); // both core for Data Analyst; SQL is verified
    expect(t.skillOrder.slice(-2)).toEqual(['Canva', 'Photoshop']);
  });
  it('puts the most relevant project first', () => {
    expect(deterministicTailoring(snap(), dataAnalyst).experience[0].title).toBe('Sales dashboard');
  });
  it('writes a role-focused summary from the candidate data only', () => {
    const { summary } = deterministicTailoring(snap(), dataAnalyst);
    expect(summary).toContain('Data Analyst');
    expect(summary).toContain('PSG College of Technology');
    expect(summary).toContain('SQL'); // verified
    expect(summary).not.toMatch(/\d{2,}/); // no invented numbers
  });
  it("keeps the candidate's own summary when they wrote one", () => {
    expect(deterministicTailoring(snap({ summary: 'My words.' }), dataAnalyst).summary).toBe('My words.');
  });
});

describe('sanitizeTailoring (AI output)', () => {
  it('keeps only skills the candidate has, matching names case-insensitively', () => {
    const t = sanitizeTailoring({ skill_order: ['sql', 'Python', 'excel', 'SQL'] }, snap());
    expect(t.skillOrder).toEqual(['SQL', 'Excel']);
  });
  it('drops a summary that invents numbers, keeps one that only uses known ones', () => {
    expect(sanitizeTailoring({ summary: 'B.E. CSE student with 3 years of SQL experience and strong Excel skills.' }, snap()).summary).toBeNull();
    const ok = 'B.E. CSE student (2022 to 2026) who builds SQL reports and Excel dashboards.';
    expect(sanitizeTailoring({ summary: ok }, snap()).summary).toBe(ok);
  });
  it('keeps experience items that exist and drops bullets with new numbers', () => {
    const t = sanitizeTailoring({
      experience: [
        { title: 'sales dashboard', bullets: ['Wrote SQL reports for 12 stores', 'Cleaned sales data in Excel'] },
        { title: 'Made-up internship', bullets: ['Led a team'] },
        { title: 'Library app', bullets: ['Built search for 500 books'] },
      ],
    }, snap());
    expect(t.experience).toEqual([
      { title: 'Sales dashboard', bullets: ['Cleaned sales data in Excel'] },
      { title: 'Library app', bullets: ['Built search for 500 books'] },
    ]);
  });
});

describe('applyTailoring', () => {
  it('sets the headline to the role and applies the order and bullets', () => {
    const s = snap();
    const out = applyTailoring(s, {
      summary: 'Focused summary.', skillOrder: ['SQL', 'Excel'],
      experience: [{ title: 'Sales dashboard', bullets: ['Built SQL reports'] }],
    }, dataAnalyst);
    expect(out.headline).toBe('Data Analyst');
    expect(out.summary).toBe('Focused summary.');
    expect(out.verifiedSkills.map((v) => v.name)).toEqual(['SQL', 'Canva']);
    expect(out.otherSkills).toEqual(['Excel', 'Photoshop']);
    expect(out.experience.map((x) => x.title)).toEqual(['Sales dashboard', 'Library app']);
    expect(out.experience[0].bullets).toEqual(['Built SQL reports']);
    expect(out.experience[1].bullets).toEqual(s.experience[0].bullets);
  });
  it('never marks a below-threshold skill as verified (verified list is only reordered)', () => {
    const out = applyTailoring(snap(), { summary: null, skillOrder: ['Excel', 'SQL'], experience: [] }, dataAnalyst);
    expect(out.verifiedSkills.map((v) => v.name).sort()).toEqual(['Canva', 'SQL']);
    expect(out.otherSkills).toContain('Excel');
  });
  it('leaves the snapshot alone without a role', () => {
    const s = snap();
    expect(applyTailoring(s, null, null)).toBe(s);
  });
});

import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { ResumeDocument, pageCount, registerFonts, renderFittedResumePdf, trimSnapshot } from '@/lib/resume/pdf';
import type { ResumeSnapshot } from '@/lib/resume/snapshot';
import { TEMPLATE_IDS, recommendTemplate } from '@/lib/resume/templates';

const base: ResumeSnapshot = {
  name: 'Priya Subramanian', nameTamil: 'பிரியா', headline: 'Data Analyst', phone: '+919876543210', email: 'priya@example.com',
  college: 'Demo College of Engineering', department: 'B.E. CSE', year: 3,
  summary: 'B.E. CSE student looking for a Data Analyst role. Skills verified by assessment: SQL, Excel.',
  education: [
    { institution: 'Demo College of Engineering', degree: 'B.E.', field: 'CSE', years: '2022 – 2026', score: '8.4' },
    { institution: 'Govt. Hr. Sec. School', degree: '12th', field: 'Maths', years: '2020 – 2022', score: '91%' },
  ],
  experience: [
    { type: 'internship', title: 'Data Intern', organization: 'Acme', period: 'Jun 2025 – Jul 2025', bullets: ['Cleaned 10k rows', 'Built a dashboard'] },
    { type: 'project', title: 'Library app', organization: null, period: '', bullets: ['Search and login'] },
  ],
  verifiedSkills: [{ name: 'SQL', level: 'advanced', badge: 'campus_verified', scorePct: 86 }],
  otherSkills: ['Canva', 'Power BI'],
  softSkills: ['Teamwork', 'Problem solving'],
  languages: [{ name: 'English', level: 'Fluent' }, { name: 'Tamil', level: 'Fluent' }],
  awards: [{ name: 'Smart India Hackathon finalist', issuer: 'AICTE', year: 2025 }],
  generatedAt: '2026-10-01T00:00:00.000Z',
};

const bullet = 'Analysed weekly sales data across stores and presented clear findings to the team every Friday';
/** Far more content than fits on a page. */
const huge = (items: number): ResumeSnapshot => ({
  ...base,
  experience: Array.from({ length: items }, (_, i) => ({
    type: i % 2 ? 'project' as const : 'internship' as const, title: `Item ${i + 1}`, organization: 'Org', period: '2024', bullets: [bullet, bullet, bullet, bullet, bullet],
  })),
});

describe('one-page fit', () => {
  it('pageCount counts pages in a rendered PDF', async () => {
    registerFonts();
    const one = await renderToBuffer(createElement(ResumeDocument, { s: base, showPct: false, version: 1 }) as never);
    const many = await renderToBuffer(createElement(ResumeDocument, { s: huge(14), showPct: false, version: 1 }) as never);
    expect(pageCount(one)).toBe(1);
    expect(pageCount(many)).toBeGreaterThan(1);
  });

  it.each(TEMPLATE_IDS)('%s: a typical resume fits one page without shrinking', async (template) => {
    const r = await renderFittedResumePdf(base, true, 1, template);
    expect(pageCount(r.pdf)).toBe(1);
    expect(r.status).toBe('ok');
  });

  it('slightly long content is shrunk or trimmed to exactly one page', async () => {
    const r = await renderFittedResumePdf(huge(6), false, 1, 'modern');
    expect(pageCount(r.pdf)).toBe(1);
    expect(['shrunk', 'trimmed']).toContain(r.status);
  });

  it('content that can never fit still yields one page and reports overflow', async () => {
    // verified skills are never trimmed, so 45 of them can't fit on one page
    const skills = Array.from({ length: 45 }, (_, i) => ({ name: `Skill ${i + 1}`, level: 'advanced' as const, badge: 'verified' as const, scorePct: 80 }));
    const r = await renderFittedResumePdf({ ...huge(14), verifiedSkills: skills }, false, 1, 'classic');
    expect(pageCount(r.pdf)).toBe(1);
    expect(r.status).toBe('overflow');
  });

  it('trim levels drop bullets and lower-priority items progressively', () => {
    const s = huge(8);
    expect(trimSnapshot(s, 0)).toBe(s);
    expect(trimSnapshot(s, 1).experience.every((x) => x.bullets.length <= 3)).toBe(true);
    expect(trimSnapshot(s, 2).experience).toHaveLength(4);
    const t3 = trimSnapshot(s, 3);
    expect(t3.experience).toHaveLength(3);
    expect(t3.experience.every((x) => x.bullets.length === 1)).toBe(true);
    expect(t3.languages).toEqual([]);
    expect(t3.verifiedSkills).toEqual(s.verifiedSkills); // verified skills are never trimmed
  });

  it('recommends a template from the target role', () => {
    expect(recommendTemplate('python-dev')).toBe('tech');
    expect(recommendTemplate('graphic-designer')).toBe('creative');
    expect(recommendTemplate('accounts-assistant')).toBe('classic');
    expect(recommendTemplate(null)).toBe('modern');
  });
});

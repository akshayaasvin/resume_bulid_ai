import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResumeView } from '@/components/resume/ResumeView';
import { codingCacheKey, withCodingBadges } from '@/lib/resume/coding-badges';
import { pageCount, renderFittedResumePdf } from '@/lib/resume/pdf';
import type { ResumeSnapshot } from '@/lib/resume/snapshot';

const { db } = vi.hoisted(() => {
  const state = { rows: [] as Record<string, unknown>[], tables: new Set<string>() };
  return {
    db: {
      state,
      from: (table: string) => {
        state.tables.add(table);
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.maybeSingle = async () => ({ data: null }); // config -> defaults (threshold 50)
        b.then = (res: (v: unknown) => unknown) => res({ data: table === 'coding_rounds' ? state.rows : [] });
        return b;
      },
    },
  };
});
vi.mock('@/lib/supabase/admin', () => ({ adminClient: () => db }));

import { codingVerifiedSkills } from '@/lib/resume/coding-badges-server';

const snap: ResumeSnapshot = {
  name: 'Priya S', nameTamil: null, phone: null, email: null, college: null, department: null, year: null, summary: null,
  education: [], experience: [],
  verifiedSkills: [
    { name: 'Python', level: 'advanced', badge: 'self', scorePct: 86 },
    { name: 'SQL', level: 'intermediate', badge: 'campus_verified', scorePct: 70 },
    { name: 'Excel', level: 'beginner', badge: 'self', scorePct: 55 },
  ],
  otherSkills: ['Canva'],
  generatedAt: '2026-10-16T00:00:00.000Z',
};

describe('withCodingBadges', () => {
  it('marks only verified skills whose coding round passed, without changing any score', () => {
    const out = withCodingBadges(snap, ['python', 'Java']);
    expect(out.verifiedSkills.find((v) => v.name === 'Python')).toEqual({ ...snap.verifiedSkills[0], codingVerified: true });
    expect(out.verifiedSkills.filter((v) => v.codingVerified).map((v) => v.name)).toEqual(['Python']);
    expect(out.verifiedSkills.map((v) => v.scorePct)).toEqual([86, 70, 55]);
    expect(out.otherSkills).toEqual(['Canva']);
  });
  it('leaves the snapshot untouched when nothing passed', () => {
    expect(withCodingBadges(snap, [])).toBe(snap);
  });
  it('gives a stable PDF cache key per set of coding-verified skills', () => {
    expect(codingCacheKey([])).toBe('');
    expect(codingCacheKey(['SQL', 'Python'])).toBe(codingCacheKey(['Python', 'SQL']));
    expect(codingCacheKey(['Python'])).not.toBe(codingCacheKey(['Python', 'SQL']));
  });
});

describe('resume rendering', () => {
  it('shows "Coding verified" next to the skill, like the Verified badge', () => {
    const html = renderToStaticMarkup(createElement(ResumeView, { s: withCodingBadges(snap, ['SQL']), showPct: false }));
    expect(html).toContain('✓ Coding verified');
    expect(html.indexOf('SQL')).toBeLessThan(html.indexOf('Coding verified'));
    expect(renderToStaticMarkup(createElement(ResumeView, { s: snap, showPct: false }))).not.toContain('Coding verified');
  });
  it('the PDF with the badge is still one page', async () => {
    const r = await renderFittedResumePdf(withCodingBadges(snap, ['Python', 'SQL']), true, 1, 'modern');
    expect(pageCount(r.pdf)).toBe(1);
  });
});

describe('codingVerifiedSkills (read-only)', () => {
  beforeEach(() => { db.state.tables.clear(); });
  it('returns skills whose coding round reached 50%, from coding_rounds only', async () => {
    db.state.rows = [
      { passed: 1, total: 2, skills: { name: 'Python' } }, // 50% -> verified
      { passed: 0, total: 2, skills: { name: 'SQL' } }, // 0% -> not
      { passed: 2, total: 0, skills: { name: 'Java' } }, // no questions -> not
    ];
    expect(await codingVerifiedSkills('p-1')).toEqual(['Python']);
    expect(db.state.tables.has('skill_scores')).toBe(false);
  });
});

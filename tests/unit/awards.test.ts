import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { awardsValid, isBlankAward, validateAward } from '@/lib/award-validation';
import { DEFAULT_SCORING } from '@/lib/config';
import { renderResumePdf } from '@/lib/resume/pdf';
import { buildSnapshot, type ResumeSnapshot, type SnapshotInput } from '@/lib/resume/snapshot';
import { ResumeView } from '@/components/resume/ResumeView';

const NOW = new Date('2026-10-15T00:00:00Z'); // max year 2031

describe('validateAward', () => {
  it('accepts a named award with optional issuer and year', () => {
    expect(validateAward({ name: 'Best Project Award', issuer: 'PSG Tech', year: 2025 }, NOW)).toEqual({});
    expect(validateAward({ name: 'NPTEL Python', issuer: null, year: null }, NOW)).toEqual({});
  });
  it('requires a name of at least 2 characters', () => {
    expect(validateAward({ name: ' ', issuer: 'NPTEL', year: null }, NOW).name).toBe('required');
    expect(validateAward({ name: 'A', issuer: null, year: null }, NOW).name).toBe('tooShort');
  });
  it('uses the Education year rules (4 digits, 1970..now+5)', () => {
    expect(validateAward({ name: 'Hackathon', issuer: null, year: 202 }, NOW).year).toBe('year');
    expect(validateAward({ name: 'Hackathon', issuer: null, year: 1969 }, NOW).year).toBe('year');
    expect(validateAward({ name: 'Hackathon', issuer: null, year: 2032 }, NOW).year).toBe('year');
    expect(validateAward({ name: 'Hackathon', issuer: null, year: 2031 }, NOW)).toEqual({});
  });
  it('ignores blank cards', () => {
    const blank = { name: '', issuer: '', year: null };
    expect(isBlankAward(blank)).toBe(true);
    expect(validateAward(blank, NOW)).toEqual({});
    expect(awardsValid([blank, { name: 'Gold medal', issuer: null, year: 2024 }], NOW)).toBe(true);
    expect(awardsValid([{ name: 'X', issuer: null, year: null }], NOW)).toBe(false);
  });
});

const input = (awards?: SnapshotInput['awards']): SnapshotInput => ({
  profile: { full_name: 'Priya S', name_tamil: null, phone_whatsapp: null, email: null, department: 'CSE', year: 3, summary: null },
  college: null, education: [], experience: [], claimed: [], scores: [], awards,
});

describe('awards on the resume', () => {
  it('buildSnapshot keeps the candidate order and drops internal fields', () => {
    const s = buildSnapshot(input([
      { name: 'Second', issuer: null, year: 2024, sort: 1 },
      { name: 'First', issuer: 'NPTEL', year: null, sort: 0 },
    ]), DEFAULT_SCORING);
    expect(s.awards).toEqual([{ name: 'First', issuer: 'NPTEL', year: null }, { name: 'Second', issuer: null, year: 2024 }]);
  });

  it('shows the "Awards & Certificates" heading only when there are awards', () => {
    const withAwards = buildSnapshot(input([{ name: 'Smart India Hackathon finalist', issuer: 'AICTE', year: 2025, sort: 0 }]), DEFAULT_SCORING);
    const html = renderToStaticMarkup(createElement(ResumeView, { s: withAwards, showPct: false }));
    expect(html).toContain('Awards &amp; Certificates');
    expect(html).toContain('Smart India Hackathon finalist');
    expect(html).toContain('AICTE');

    for (const s of [buildSnapshot(input([]), DEFAULT_SCORING), buildSnapshot(input(undefined), DEFAULT_SCORING)]) {
      expect(renderToStaticMarkup(createElement(ResumeView, { s, showPct: false }))).not.toContain('Awards');
    }
    const old = { ...withAwards } as ResumeSnapshot; // snapshots saved before awards existed
    delete old.awards;
    expect(renderToStaticMarkup(createElement(ResumeView, { s: old, showPct: false }))).not.toContain('Awards');
  });

  it('renders the PDF with an awards section', async () => {
    const s = buildSnapshot(input([{ name: 'NPTEL Elite – Python', issuer: 'IIT Madras', year: 2025, sort: 0 }]), DEFAULT_SCORING);
    const buf = await renderResumePdf(s, false, 1);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

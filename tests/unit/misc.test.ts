import { describe, expect, it } from 'vitest';
import { authEmailForPhone, normalizeIndianPhone } from '@/lib/phone';
import { buildSnapshot, type SnapshotInput } from '@/lib/resume/snapshot';
import { DEFAULT_SCORING } from '@/lib/config';
import { translate } from '@/i18n';
import en from '@/i18n/en.json';
import ta from '@/i18n/ta.json';

describe('normalizeIndianPhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['91-9876543210', '+919876543210'],
    ['09876543210', '+919876543210'],
  ])('%s -> %s', (input, out) => expect(normalizeIndianPhone(input)).toBe(out));

  it.each(['12345', '5876543210', '+1 9876543210', '98765432101', 'abcdefghij'])('rejects %s', (input) => {
    expect(normalizeIndianPhone(input)).toBeNull();
  });

  it('derives a stable non-routable auth email', () => {
    expect(authEmailForPhone('+919876543210')).toBe('p919876543210@users.resumebuild.invalid');
  });
});

describe('buildSnapshot', () => {
  const input: SnapshotInput = {
    profile: { full_name: 'Priya S', name_tamil: 'பிரியா', phone_whatsapp: '+919876543210', email: null, department: 'CSE', year: 3, summary: null },
    college: 'Demo College',
    education: [],
    experience: [{ type: 'project', title: 'Library app', organization: null, start_date: null, end_date: null, bullets: [], description: 'Built search\nAdded login', sort: 0 }],
    claimed: [
      { skill_id: 's-py', name: 'Python' },
      { skill_id: 's-sql', name: 'SQL' },
      { skill_id: null, name: 'Canva' },
      { skill_id: 's-xl', name: 'Excel' },
    ],
    scores: [
      { skill_id: 's-py', skill_name: 'Python', score_pct: 86, level: 'advanced', badge: 'campus_verified' },
      { skill_id: 's-sql', skill_name: 'SQL', score_pct: 42, level: 'needs_improvement', badge: 'self' },
      { skill_id: 's-xl', skill_name: 'Excel', score_pct: 66, level: 'intermediate', badge: 'self' },
    ],
  };
  const s = buildSnapshot(input, DEFAULT_SCORING, new Date('2026-01-01'));

  it('lists only >= 50% scores as verified, campus first', () => {
    expect(s.verifiedSkills.map((v) => v.name)).toEqual(['Python', 'Excel']);
  });
  it('never leaks a < 50% skill anywhere on the resume', () => {
    expect(JSON.stringify(s)).not.toContain('SQL');
    expect(JSON.stringify(s)).not.toContain('42');
  });
  it('keeps untested claimed skills as self-declared', () => {
    expect(s.otherSkills).toEqual(['Canva']);
  });
  it('turns description lines into bullets', () => {
    expect(s.experience[0].bullets).toEqual(['Built search', 'Added login']);
  });
});

describe('i18n', () => {
  it('Tamil dictionary covers every English key', () => {
    const missing = Object.keys(en).filter((k) => !(k in ta));
    expect(missing).toEqual([]);
  });
  it('interpolates and falls back to English', () => {
    expect(translate('en', 'wizard.step', { n: 2 })).toBe('Step 2 of 3');
    expect(translate('ta', 'nonexistent.key')).toBe('nonexistent.key');
  });
});

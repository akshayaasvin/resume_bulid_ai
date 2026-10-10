import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING, mergeConfig } from '@/lib/config';
import { badgeFor, isBetterScore, isPublicScore, levelFor, meetsLevel, shouldAutoFlag, type BadgeInput } from '@/lib/scoring';

const cfg = DEFAULT_SCORING;

describe('levelFor', () => {
  it.each([
    [100, 'advanced'], [80, 'advanced'], [79.99, 'intermediate'], [65, 'intermediate'],
    [64.9, 'beginner'], [50, 'beginner'], [49.99, 'needs_improvement'], [0, 'needs_improvement'],
  ])('%s%% -> %s', (pct, level) => {
    expect(levelFor(pct, cfg)).toBe(level);
  });

  it('uses configured thresholds', () => {
    const custom = { ...cfg, advancedMin: 90, intermediateMin: 70, beginnerMin: 40 };
    expect(levelFor(85, custom)).toBe('intermediate');
    expect(levelFor(45, custom)).toBe('beginner');
  });
});

describe('isPublicScore', () => {
  it('hides anything below 50%', () => {
    expect(isPublicScore(49.99, cfg)).toBe(false);
    expect(isPublicScore(50, cfg)).toBe(true);
  });
});

describe('meetsLevel', () => {
  it('compares level ranks', () => {
    expect(meetsLevel('advanced', 'intermediate')).toBe(true);
    expect(meetsLevel('beginner', 'intermediate')).toBe(false);
    expect(meetsLevel('intermediate', 'intermediate')).toBe(true);
  });
});

describe('badgeFor', () => {
  const expires = new Date('2026-01-01T10:20:00Z');
  const base: BadgeInput = {
    mode: 'campus', proctorVerified: true, tabSwitches: 0, flagged: false,
    submittedAt: new Date('2026-01-01T10:19:00Z'), expiresAt: expires, graceMinutes: 5,
  };

  it('campus + PIN + few tab switches + on time -> campus_verified', () => {
    expect(badgeFor(base, cfg)).toBe('campus_verified');
  });
  it('allows exactly 2 tab switches', () => {
    expect(badgeFor({ ...base, tabSwitches: 2 }, cfg)).toBe('campus_verified');
  });
  it('3 tab switches -> verified (not campus)', () => {
    expect(badgeFor({ ...base, tabSwitches: 3 }, cfg)).toBe('verified');
  });
  it('submitted inside grace window still counts', () => {
    expect(badgeFor({ ...base, submittedAt: new Date('2026-01-01T10:25:00Z') }, cfg)).toBe('campus_verified');
  });
  it('submitted after grace -> verified', () => {
    expect(badgeFor({ ...base, submittedAt: new Date('2026-01-01T10:25:01Z') }, cfg)).toBe('verified');
  });
  it('no valid PIN -> self', () => {
    expect(badgeFor({ ...base, proctorVerified: false }, cfg)).toBe('self');
  });
  it('self mode -> self', () => {
    expect(badgeFor({ ...base, mode: 'self' }, cfg)).toBe('self');
  });
  it('flagged -> self', () => {
    expect(badgeFor({ ...base, flagged: true }, cfg)).toBe('self');
  });
});

describe('isBetterScore (best score per skill)', () => {
  it('first score always wins', () => {
    expect(isBetterScore({ scorePct: 10, badge: 'self' }, null)).toBe(true);
  });
  it('higher score wins regardless of badge', () => {
    expect(isBetterScore({ scorePct: 81, badge: 'self' }, { scorePct: 80, badge: 'campus_verified' })).toBe(true);
  });
  it('lower score never replaces', () => {
    expect(isBetterScore({ scorePct: 70, badge: 'campus_verified' }, { scorePct: 75, badge: 'self' })).toBe(false);
  });
  it('tie prefers stronger badge', () => {
    expect(isBetterScore({ scorePct: 75, badge: 'campus_verified' }, { scorePct: 75, badge: 'self' })).toBe(true);
    expect(isBetterScore({ scorePct: 75, badge: 'self' }, { scorePct: 75, badge: 'verified' })).toBe(false);
  });
});

describe('shouldAutoFlag', () => {
  it('flags at 3 tab switches or 3 fullscreen exits', () => {
    expect(shouldAutoFlag(2, 2, cfg)).toBeNull();
    expect(shouldAutoFlag(3, 0, cfg)).toMatch(/tab/);
    expect(shouldAutoFlag(0, 3, cfg)).toMatch(/fullscreen/);
  });
});

describe('mergeConfig', () => {
  it('merges overrides and rejects invalid ones', () => {
    expect(mergeConfig('scoring', { advancedMin: 85 }).advancedMin).toBe(85);
    expect(mergeConfig('scoring', { advancedMin: 'x' })).toEqual(DEFAULT_SCORING);
    expect(mergeConfig('scoring', null)).toEqual(DEFAULT_SCORING);
  });
});

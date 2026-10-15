import type { ResumeSnapshot } from './snapshot';

/**
 * Adds the "Coding verified" mark to verified skills whose optional coding round passed.
 * Applied when the resume is shown (not stored), so older resume versions get it too.
 * Only skills already on the resume as verified are marked; scores are never changed.
 */
export function withCodingBadges(s: ResumeSnapshot, codingVerified: string[]): ResumeSnapshot {
  if (!codingVerified.length) return s;
  const names = new Set(codingVerified.map((n) => n.trim().toLowerCase()));
  return {
    ...s,
    verifiedSkills: s.verifiedSkills.map((v) => (names.has(v.name.trim().toLowerCase()) ? { ...v, codingVerified: true } : v)),
  };
}

/** Short stable key for the PDF cache, so a newly passed coding round gives a fresh PDF. */
export function codingCacheKey(codingVerified: string[]): string {
  return codingVerified.length ? `-c-${[...codingVerified].map((n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '')).sort().join('_')}` : '';
}

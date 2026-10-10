import type { ScoringConfig } from './config';

export type SkillLevel = 'advanced' | 'intermediate' | 'beginner' | 'needs_improvement';
export type Badge = 'self' | 'verified' | 'campus_verified';

export const LEVEL_LABEL: Record<SkillLevel, string> = {
  advanced: 'Advanced',
  intermediate: 'Intermediate',
  beginner: 'Beginner',
  needs_improvement: 'Needs Improvement',
};

const LEVEL_RANK: Record<SkillLevel, number> = { needs_improvement: 0, beginner: 1, intermediate: 2, advanced: 3 };
const BADGE_RANK: Record<Badge, number> = { self: 0, verified: 1, campus_verified: 2 };

export function levelFor(scorePct: number, cfg: ScoringConfig): SkillLevel {
  if (scorePct >= cfg.advancedMin) return 'advanced';
  if (scorePct >= cfg.intermediateMin) return 'intermediate';
  if (scorePct >= cfg.beginnerMin) return 'beginner';
  return 'needs_improvement';
}

export function levelRank(level: SkillLevel): number {
  return LEVEL_RANK[level];
}

export function meetsLevel(actual: SkillLevel, required: SkillLevel): boolean {
  return LEVEL_RANK[actual] >= LEVEL_RANK[required];
}

/**
 * Below the beginner threshold a score must never appear on a resume or any public / employer
 * view; it belongs on the skill-gap list instead.
 */
export function isPublicScore(scorePct: number, cfg: ScoringConfig): boolean {
  return scorePct >= cfg.beginnerMin;
}

export interface BadgeInput {
  mode: 'self' | 'campus';
  proctorVerified: boolean;
  tabSwitches: number;
  flagged: boolean;
  submittedAt: Date;
  expiresAt: Date;
  graceMinutes: number;
}

/**
 * campus_verified: campus mode + valid PIN + tab switches within limit + submitted within grace.
 * verified:        campus attempt that missed one of those conditions (still supervised session).
 * self:            self mode, or any flagged attempt.
 */
export function badgeFor(a: BadgeInput, cfg: ScoringConfig): Badge {
  if (a.mode !== 'campus' || a.flagged || !a.proctorVerified) return 'self';
  const deadline = a.expiresAt.getTime() + a.graceMinutes * 60_000;
  const inTime = a.submittedAt.getTime() <= deadline;
  if (inTime && a.tabSwitches <= cfg.maxTabSwitchesForCampusBadge) return 'campus_verified';
  return 'verified';
}

export interface ScoreRecord {
  scorePct: number;
  badge: Badge;
}

/** Keep the best score per skill; on an exact tie prefer the stronger badge. */
export function isBetterScore(candidate: ScoreRecord, existing: ScoreRecord | null | undefined): boolean {
  if (!existing) return true;
  if (candidate.scorePct !== existing.scorePct) return candidate.scorePct > existing.scorePct;
  return BADGE_RANK[candidate.badge] > BADGE_RANK[existing.badge];
}

export function shouldAutoFlag(tabSwitches: number, fullscreenExits: number, cfg: ScoringConfig): string | null {
  if (tabSwitches >= cfg.autoFlagAfter) return `tab_switches>=${cfg.autoFlagAfter}`;
  if (fullscreenExits >= cfg.autoFlagAfter) return `fullscreen_exits>=${cfg.autoFlagAfter}`;
  return null;
}

export function roundPct(n: number): number {
  return Math.round(n * 100) / 100;
}

import { z } from 'zod';

/**
 * Runtime-tunable settings. Defaults live here; super_admin overrides are stored in the
 * `config` table (key = section name, value = partial JSON) and merged on read.
 */
export const scoringConfigSchema = z.object({
  advancedMin: z.number().min(0).max(100),
  intermediateMin: z.number().min(0).max(100),
  beginnerMin: z.number().min(0).max(100),
  maxTabSwitchesForCampusBadge: z.number().int().min(0),
  autoFlagAfter: z.number().int().min(1),
});

export const testConfigSchema = z.object({
  durationMinutes: z.number().int().min(1),
  mix: z.object({ easy: z.number().int().min(0), medium: z.number().int().min(0), hard: z.number().int().min(0) }),
  maxCodingQuestions: z.number().int().min(0),
  selfModeGraceMinutes: z.number().int().min(0),
  /** Submissions later than expiry + grace + this are still graded but flagged. */
  lateHardLimitMinutes: z.number().int().min(0),
  pinMaxWrong: z.number().int().min(1),
  pinLockMinutes: z.number().int().min(1),
  pinRotateMinutes: z.number().int().min(1),
});

export const limitsConfigSchema = z.object({
  aiDailyCallsPerUser: z.number().int().min(0),
});

export type ScoringConfig = z.infer<typeof scoringConfigSchema>;
export type TestConfig = z.infer<typeof testConfigSchema>;
export type LimitsConfig = z.infer<typeof limitsConfigSchema>;

export const DEFAULT_SCORING: ScoringConfig = {
  advancedMin: 80,
  intermediateMin: 65,
  beginnerMin: 50,
  maxTabSwitchesForCampusBadge: 2,
  autoFlagAfter: 3,
};

export const DEFAULT_TEST: TestConfig = {
  durationMinutes: 20,
  mix: { easy: 5, medium: 7, hard: 3 },
  maxCodingQuestions: 2,
  selfModeGraceMinutes: 2,
  lateHardLimitMinutes: 60,
  pinMaxWrong: 5,
  pinLockMinutes: 10,
  pinRotateMinutes: 30,
};

export const DEFAULT_LIMITS: LimitsConfig = {
  aiDailyCallsPerUser: 10,
};

export const CONFIG_DEFAULTS = {
  scoring: DEFAULT_SCORING,
  test: DEFAULT_TEST,
  limits: DEFAULT_LIMITS,
} as const;

export type ConfigKey = keyof typeof CONFIG_DEFAULTS;

const schemas = { scoring: scoringConfigSchema, test: testConfigSchema, limits: limitsConfigSchema };

/** Merge a stored override onto defaults; invalid overrides fall back to defaults. */
export function mergeConfig<K extends ConfigKey>(key: K, stored: unknown): (typeof CONFIG_DEFAULTS)[K] {
  const base = CONFIG_DEFAULTS[key];
  if (!stored || typeof stored !== 'object') return base;
  const merged = { ...base, ...(stored as object) };
  const parsed = schemas[key].safeParse(merged);
  return (parsed.success ? parsed.data : base) as (typeof CONFIG_DEFAULTS)[K];
}

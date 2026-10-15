/**
 * Candidate funnel. Each step gates the next: a candidate may revisit earlier steps but is
 * redirected to their current step when they open a later one. Pure (runs in middleware).
 */
export const FLOW_STEPS = ['wizard', 'tests', 'done'] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];

export const STEP_HOME: Record<FlowStep, string> = {
  wizard: '/wizard',
  tests: '/test',
  done: '/dashboard',
};

/**
 * The candidate's declared skills, by test availability:
 * - testable: a test exists (question bank or a cached AI-generated test);
 * - waiting: no test yet, but one can still be generated on demand;
 * - unavailable: no test and generation recently failed (or the name isn't a testable skill).
 */
export interface SkillTestAvailability { testable: number; waiting: number; unavailable: number }

/**
 * Minimum completed tests before job matches unlock: 3, or every testable declared skill if fewer.
 * Never a dead end: if none of the declared skills can get a test, nothing is required (0).
 */
export const MIN_TESTS = 3;
export function requiredTests(a: SkillTestAvailability): number {
  if (a.testable > 0) return Math.min(MIN_TESTS, a.testable);
  if (a.waiting > 0) return 1; // generate + take one
  if (a.unavailable > 0) return 0; // tests for their skills are being prepared: don't block
  return 1; // no skills declared: take any test from the catalogue
}

export function isFlowStep(v: unknown): v is FlowStep {
  return typeof v === 'string' && (FLOW_STEPS as readonly string[]).includes(v);
}

const rank = (s: FlowStep) => FLOW_STEPS.indexOf(s);

/** Never moves a candidate backwards (e.g. adding a skill after finishing tests). */
export function laterStep(a: FlowStep | null, b: FlowStep): FlowStep {
  return a && rank(a) > rank(b) ? a : b;
}

export function computeStep(input: { wizardStep: number; completedTests: number } & SkillTestAvailability): FlowStep {
  if (input.wizardStep < 4) return 'wizard';
  if (input.completedTests < requiredTests(input)) return 'tests';
  return 'done';
}

const matches = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** The step a page belongs to, or null when the page is not part of the funnel. */
export function stepForPath(path: string): FlowStep | null {
  if (matches(path, '/wizard')) return 'wizard';
  if (matches(path, '/test') || matches(path, '/results')) return 'tests';
  if (matches(path, '/dashboard') || matches(path, '/resume')) return 'done';
  return null;
}

/** Where to send a candidate who opens `path`, or null to let the request through. */
export function gateRedirect(current: FlowStep | null, path: string): string | null {
  if (!current) return null; // unknown step (e.g. not yet backfilled): don't block
  const needed = stepForPath(path);
  if (!needed || rank(needed) <= rank(current)) return null;
  return STEP_HOME[current];
}

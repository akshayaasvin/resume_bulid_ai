import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkGeneratedTest, mixFor, skillSlug, type GeneratedTest } from '@/lib/ai/skill-test-schema';

// ---------------------------------------------------------------------------
// Output validation
// ---------------------------------------------------------------------------
const q = (i: number, o: Partial<GeneratedTest['questions'][number]> = {}) => ({
  question: `In AutoCAD, which command would you use for task number ${i}?`,
  options: [`Option A${i}`, `Option B${i}`, `Option C${i}`, `Option D${i}`],
  correct_index: i % 4,
  explanation: 'Because it is the right tool for the job.',
  level: i < 5 ? (i % 2 ? 'Beginner' : 'beginner') : 'intermediate', // model casing varies
  ...o,
});
const valid = (): GeneratedTest => ({ testable: true, questions: Array.from({ length: 10 }, (_, i) => q(i)) });

describe('checkGeneratedTest', () => {
  it('accepts exactly 10 questions with 4 unique options and a valid answer', () => {
    const r = checkGeneratedTest(valid());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.questions).toHaveLength(10);
      expect(mixFor(r.questions)).toEqual({ easy: 5, medium: 5, hard: 0 });
    }
  });
  it('rejects the wrong number of questions', () => {
    const t = valid(); t.questions.pop();
    expect(checkGeneratedTest(t)).toMatchObject({ ok: false });
  });
  it('rejects duplicate options (case-insensitive), wrong option count, bad answer index', () => {
    const dup = valid(); dup.questions[3] = q(3, { options: ['Yes', 'yes ', 'No', 'Maybe'] });
    expect(checkGeneratedTest(dup)).toMatchObject({ ok: false, reason: expect.stringContaining('unique') });
    const three = valid(); three.questions[0] = q(0, { options: ['a1', 'b1', 'c1'] });
    expect(checkGeneratedTest(three)).toMatchObject({ ok: false });
    const idx = valid(); idx.questions[9] = q(9, { correct_index: 4 });
    expect(checkGeneratedTest(idx)).toMatchObject({ ok: false, reason: expect.stringContaining('answer index') });
  });
  it('rejects duplicate questions and non-skills', () => {
    const dup = valid(); dup.questions[1] = { ...dup.questions[0] };
    expect(checkGeneratedTest(dup)).toMatchObject({ ok: false });
    expect(checkGeneratedTest({ testable: false, questions: [] })).toEqual({ ok: false, reason: 'not_testable' });
  });
});

describe('skillSlug', () => {
  it.each([['HTML/CSS', 'html-css'], ['MS Word', 'ms-word'], ['AutoCAD', 'autocad'], ['C++', 'cplusplus'], ['C#', 'csharp'], ['  ', 'skill']])(
    '%s -> %s', (name, slug) => expect(skillSlug(name)).toBe(slug));
});

// ---------------------------------------------------------------------------
// ensureSkillTest: generate once, then serve the cached test to everyone
// ---------------------------------------------------------------------------
const { parse, db } = vi.hoisted(() => {
  const state = {
    skills: [] as { id: string; slug: string; name: string }[],
    gen: null as null | Record<string, unknown>,
    usage: 0,
  };
  // Minimal stand-in for the Supabase admin client: just enough for skill-tests.ts and getConfig().
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    const result = () => {
      if (table === 'skills') return { data: state.skills };
      if (table === 'ai_usage') return { count: state.usage, data: null };
      return { data: null };
    };
    for (const m of ['select', 'eq', 'gte', 'in', 'order']) b[m] = () => b;
    b.maybeSingle = async () => ({ data: table === 'skill_test_generation' ? state.gen : null });
    b.single = async () => ({ data: table === 'skills' ? state.skills.at(-1) : null });
    b.insert = async () => { if (table === 'ai_usage') state.usage++; return { error: null }; };
    b.upsert = async (row: Record<string, unknown>) => { if (table === 'skill_test_generation') state.gen = row; return { error: null }; };
    b.then = (res: (v: unknown) => unknown) => res(result());
    return b;
  };
  const client = {
    state,
    from: builder,
    rpc: async (_fn: string, args: { p_name: string; p_slug: string }) => {
      const id = `skill-${state.skills.length + 1}`;
      state.skills.push({ id, slug: args.p_slug, name: args.p_name });
      return { data: id, error: null };
    },
  };
  return { parse: vi.fn(), db: client };
});

vi.mock('@/lib/supabase/admin', () => ({ adminClient: () => db }));
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error { status?: number }
  class Anthropic {
    static APIError = APIError;
    messages = { parse };
  }
  return { default: Anthropic };
});

const reply = (parsed: GeneratedTest | null) => ({ stop_reason: 'end_turn', parsed_output: parsed, usage: { input_tokens: 100, output_tokens: 900 } });

describe('ensureSkillTest', () => {
  beforeEach(() => {
    db.state.skills = [];
    db.state.gen = null;
    db.state.usage = 0;
    parse.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  it('generates once, then the second user gets the cached test with no API call', async () => {
    const { ensureSkillTest } = await import('@/lib/ai/skill-tests');
    parse.mockResolvedValueOnce(reply(valid()));

    const first = await ensureSkillTest('AutoCAD', 'user-1');
    expect(first).toEqual({ ok: true, slug: 'autocad', cached: false });
    expect(parse).toHaveBeenCalledTimes(1);

    const second = await ensureSkillTest('  autocad ', 'user-2'); // normalised name
    expect(second).toEqual({ ok: true, slug: 'autocad', cached: true });
    expect(parse).toHaveBeenCalledTimes(1); // no new API call
  });

  it('retries once on invalid output', async () => {
    const { ensureSkillTest } = await import('@/lib/ai/skill-tests');
    const bad = valid(); bad.questions.pop();
    parse.mockResolvedValueOnce(reply(bad)).mockResolvedValueOnce(reply(valid()));
    expect(await ensureSkillTest('MS Word', 'user-1')).toMatchObject({ ok: true, slug: 'ms-word' });
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('records a failure after the retry also fails, and does not call the API again soon after', async () => {
    const { ensureSkillTest } = await import('@/lib/ai/skill-tests');
    parse.mockResolvedValue(reply(null));
    expect(await ensureSkillTest('AutoCAD', 'user-1')).toEqual({ ok: false, reason: 'generation_failed' });
    expect(parse).toHaveBeenCalledTimes(2);
    expect(db.state.gen).toMatchObject({ name_key: 'autocad', status: 'failed' });

    expect(await ensureSkillTest('AutoCAD', 'user-2')).toEqual({ ok: false, reason: 'recently_failed' });
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('fails without calling the API when no key is configured', async () => {
    const { ensureSkillTest } = await import('@/lib/ai/skill-tests');
    delete process.env.ANTHROPIC_API_KEY;
    expect(await ensureSkillTest('AutoCAD', 'user-1')).toEqual({ ok: false, reason: 'generation_failed' });
    expect(parse).not.toHaveBeenCalled();
  });

  it('respects the per-user daily limit', async () => {
    const { ensureSkillTest } = await import('@/lib/ai/skill-tests');
    db.state.usage = 10; // default aiDailyCallsPerUser
    expect(await ensureSkillTest('AutoCAD', 'user-1')).toEqual({ ok: false, reason: 'rate_limited' });
    expect(parse).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BANK_TARGET, FIRST_BATCH, TOPUP_BATCH, checkBatch, levelSplit, skillSlug, type GeneratedBatch,
} from '@/lib/ai/skill-test-schema';

// ---------------------------------------------------------------------------
// Batch validation
// ---------------------------------------------------------------------------
let seq = 0;
const q = (o: Partial<GeneratedBatch['questions'][number]> = {}) => {
  const i = seq++;
  return {
    type: i % 3 === 0 ? 'scenario' : 'mcq',
    level: ['beginner', 'Intermediate', 'advanced'][i % 3],
    question: `In AutoCAD, which command would you use for task number ${i}?`,
    options: [`Option A${i}`, `Option B${i}`, `Option C${i}`, `Option D${i}`],
    correct_index: i % 4,
    explanation: 'Because it is the right tool for the job.',
    ...o,
  };
};
const batch = (n: number): GeneratedBatch => ({ testable: true, questions: Array.from({ length: n }, () => q()) });

describe('checkBatch', () => {
  it('accepts the requested count and maps type + level', () => {
    const r = checkBatch(batch(12), 12);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.questions.map((x) => x.difficulty).sort()).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]);
      expect(r.questions.some((x) => x.type === 'scenario')).toBe(true);
    }
  });
  it('rejects a wrong count, duplicate/missing options, a bad answer index', () => {
    expect(checkBatch(batch(11), 12)).toMatchObject({ ok: false });
    const dup = batch(3); dup.questions[1] = q({ options: ['Yes', 'yes ', 'No', 'Maybe'] });
    expect(checkBatch(dup, 3)).toMatchObject({ ok: false, reason: expect.stringContaining('unique') });
    const three = batch(3); three.questions[0] = q({ options: ['a', 'b', 'c'] });
    expect(checkBatch(three, 3)).toMatchObject({ ok: false });
    const idx = batch(3); idx.questions[2] = q({ correct_index: 4 });
    expect(checkBatch(idx, 3)).toMatchObject({ ok: false, reason: expect.stringContaining('answer index') });
  });
  it('rejects questions already in the bank (any spacing/case) and non-skills', () => {
    const b = batch(2);
    expect(checkBatch(b, 2, [`  ${b.questions[1].question.toUpperCase()} `])).toMatchObject({ ok: false, reason: expect.stringContaining('duplicate') });
    expect(checkBatch({ testable: false, questions: [] }, 12)).toEqual({ ok: false, reason: 'not_testable' });
  });
});

describe('levelSplit / skillSlug', () => {
  it('keeps every batch close to the 10/12/8 bank shape', () => {
    expect(levelSplit(12)).toEqual({ beginner: 4, intermediate: 5, advanced: 3 });
    expect(levelSplit(9)).toEqual({ beginner: 3, intermediate: 4, advanced: 2 });
    expect(levelSplit(30)).toEqual({ beginner: 10, intermediate: 12, advanced: 8 });
  });
  it.each([['HTML/CSS', 'html-css'], ['MS Word', 'ms-word'], ['AutoCAD', 'autocad'], ['C++', 'cplusplus'], ['C#', 'csharp'], ['  ', 'skill']])(
    '%s -> %s', (name, slug) => expect(skillSlug(name)).toBe(slug));
});

// ---------------------------------------------------------------------------
// Background bank generation with an in-memory database
// ---------------------------------------------------------------------------
const { parse, db, background } = vi.hoisted(() => {
  const state = {
    skills: [] as { id: string; slug: string; name: string }[],
    questions: [] as { skill_id: string; body: string }[],
    gen: new Map<string, Record<string, unknown>>(),
    usage: 0,
    claimHeld: false,
  };
  const builder = (table: string) => {
    const filters: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, v: unknown) => { filters[col] = v; return b; };
    for (const m of ['gte', 'in', 'order']) b[m] = () => b;
    const rows = () => {
      if (table === 'skills') return state.skills.filter((s) => !filters.slug || s.slug === filters.slug);
      if (table === 'questions') return state.questions.filter((x) => x.skill_id === filters.skill_id);
      if (table === 'skill_test_generation') return Array.from(state.gen.values());
      return [];
    };
    b.maybeSingle = async () => ({ data: rows()[0] ?? null });
    b.single = async () => ({ data: rows()[0] ?? null });
    b.insert = async () => { if (table === 'ai_usage') state.usage++; return { error: null }; };
    b.upsert = async (row: Record<string, unknown>) => { state.gen.set(row.name_key as string, row); return { error: null }; };
    b.update = (patch: Record<string, unknown>) => ({
      eq: async (_c: string, key: string) => { state.gen.set(key, { ...(state.gen.get(key) ?? { name_key: key }), ...patch }); return { error: null }; },
    });
    b.then = (res: (v: unknown) => unknown) => res(table === 'ai_usage' ? { count: state.usage, data: null } : { data: rows() });
    return b;
  };
  const add = (skillId: string, qs: { body: string }[]) => qs.forEach((x) => state.questions.push({ skill_id: skillId, body: x.body }));
  const client = {
    state,
    from: builder,
    rpc: async (fn: string, a: Record<string, unknown>) => {
      if (fn === 'claim_skill_generation') {
        if (state.claimHeld) return { data: false, error: null };
        state.gen.set(a.p_key as string, { name_key: a.p_key, status: 'pending', updated_at: new Date().toISOString() });
        return { data: true, error: null };
      }
      if (fn === 'create_ai_skill_test') {
        const id = `skill-${state.skills.length + 1}`;
        state.skills.push({ id, slug: a.p_slug as string, name: a.p_name as string });
        add(id, a.p_questions as { body: string }[]);
        return { data: id, error: null };
      }
      if (fn === 'add_ai_questions') { add(a.p_skill_id as string, a.p_questions as { body: string }[]); return { data: 1, error: null }; }
      return { data: null, error: null };
    },
  };
  return { parse: vi.fn(), db: client, background: [] as Promise<unknown>[] };
});

vi.mock('@/lib/supabase/admin', () => ({ adminClient: () => db }));
vi.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => { background.push(p); } }));
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error { status?: number }
  class Anthropic {
    static APIError = APIError;
    messages = { parse };
  }
  return { default: Anthropic };
});

/** The mocked model returns exactly the number of questions the prompt asks for. */
function modelReplies() {
  parse.mockImplementation(async (req: { messages: { content: string }[] }) => {
    const n = Number(/exactly (\d+) multiple-choice/.exec(req.messages[0].content)![1]);
    return { stop_reason: 'end_turn', parsed_output: batch(n), usage: { input_tokens: 100, output_tokens: 900 } };
  });
}

describe('prepareSkillBank / prepareInBackground', () => {
  beforeEach(() => {
    db.state.skills = []; db.state.questions = []; db.state.gen.clear(); db.state.usage = 0; db.state.claimHeld = false;
    background.length = 0;
    parse.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  it('builds a new skill in the background: first batch of 12, then top-ups to 30', async () => {
    const { prepareInBackground, skillTestStatuses } = await import('@/lib/ai/skill-tests');
    modelReplies();
    prepareInBackground(['AutoCAD'], 'user-1'); // returns immediately
    expect((await skillTestStatuses(['AutoCAD'])).get('autocad')).toEqual({ state: 'pending' });
    await Promise.all(background);

    expect(db.state.skills).toEqual([{ id: 'skill-1', slug: 'autocad', name: 'AutoCAD' }]);
    expect(db.state.questions).toHaveLength(BANK_TARGET);
    const sizes = parse.mock.calls.map((c) => Number(/exactly (\d+)/.exec(c[0].messages[0].content)![1]));
    expect(sizes[0]).toBe(FIRST_BATCH);
    expect(sizes.slice(1).every((n) => n <= TOPUP_BATCH)).toBe(true);
    expect((await skillTestStatuses(['  autocad '])).get('autocad')).toEqual({ state: 'ready', slug: 'autocad' });
  });

  it('a full bank makes no API call (second user, or a test start)', async () => {
    const { prepareSkillBank } = await import('@/lib/ai/skill-tests');
    modelReplies();
    await prepareSkillBank('AutoCAD', 'user-1');
    const calls = parse.mock.calls.length;
    await prepareSkillBank('autocad', 'user-2');
    expect(parse.mock.calls.length).toBe(calls);
  });

  it('only one job works on a skill at a time (lease)', async () => {
    const { prepareSkillBank } = await import('@/lib/ai/skill-tests');
    modelReplies();
    db.state.claimHeld = true;
    await prepareSkillBank('AutoCAD', 'user-1');
    expect(parse).not.toHaveBeenCalled();
  });

  it('retries a bad batch once, then marks the skill failed (retried later, never a dead end)', async () => {
    const { prepareSkillBank, skillTestStatuses } = await import('@/lib/ai/skill-tests');
    parse.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: null, usage: { input_tokens: 1, output_tokens: 1 } });
    await prepareSkillBank('AutoCAD', 'user-1');
    expect(parse).toHaveBeenCalledTimes(2);
    expect((await skillTestStatuses(['AutoCAD'])).get('autocad')).toEqual({ state: 'failed' });
  });

  it('marks a skill failed without calling the API when no key is configured', async () => {
    const { prepareSkillBank, skillTestStatuses } = await import('@/lib/ai/skill-tests');
    delete process.env.ANTHROPIC_API_KEY;
    await prepareSkillBank('AutoCAD', 'user-1');
    expect(parse).not.toHaveBeenCalled();
    expect((await skillTestStatuses(['AutoCAD'])).get('autocad')).toEqual({ state: 'failed' });
  });

  it("respects the candidate's daily limit for new skills", async () => {
    const { prepareSkillBank } = await import('@/lib/ai/skill-tests');
    modelReplies();
    db.state.usage = 10;
    await prepareSkillBank('AutoCAD', 'user-1');
    expect(parse).not.toHaveBeenCalled();
  });
});

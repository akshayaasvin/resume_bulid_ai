import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain ESM helper shared with scripts/db.mjs
import { loadSeed, validateSeed } from '../../scripts/seed-data.mjs';
// @ts-expect-error - plain ESM script
import { renderReview } from '../../scripts/question-review.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_TEST, resolveMix } from '@/lib/config';
import { mulberry32, pickQuestions } from '@/lib/test-engine/questions';

type Q = { key: string; type: string; difficulty: number; body: string; options?: string[]; correct?: number; explanation?: string };
type Skill = { slug: string; test_mix?: { easy: number; medium: number; hard: number }; questions: Q[] };

const seed = loadSeed() as { skills: Skill[] };
const NEW_BANKS = ['javascript', 'html-css', 'java', 'powerpoint', 'canva', 'teamwork', 'public-speaking'];
const banks = NEW_BANKS.map((slug) => seed.skills.find((s) => s.slug === slug)!);

describe('P1.5 question banks', () => {
  it('registers all seven new skills', () => {
    expect(banks.every(Boolean)).toBe(true);
  });

  it('has no duplicate question keys across the whole seed', () => {
    const keys = seed.skills.flatMap((s) => s.questions.map((q) => q.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(NEW_BANKS)('%s: 30 questions, 10/12/8 by difficulty, 4/5/3 test mix', (slug) => {
    const s = seed.skills.find((x) => x.slug === slug)!;
    expect(s.questions).toHaveLength(30);
    const count = (d: number) => s.questions.filter((q) => q.difficulty === d).length;
    expect([count(1), count(2), count(3)]).toEqual([10, 12, 8]);
    expect(s.test_mix).toEqual({ easy: 4, medium: 5, hard: 3 });
  });

  it.each(NEW_BANKS)('%s: every question has valid tags, exactly one correct option and an explanation', (slug) => {
    const s = seed.skills.find((x) => x.slug === slug)!;
    for (const q of s.questions) {
      expect(['mcq', 'scenario'], q.key).toContain(q.type);
      expect([1, 2, 3], q.key).toContain(q.difficulty);
      expect(q.key, q.key).toMatch(new RegExp(`-${'emh'[q.difficulty - 1]}\\d{2}$`)); // key letter matches difficulty
      expect(q.options, q.key).toHaveLength(4);
      expect(new Set(q.options).size, q.key).toBe(4); // distinct options => only one can be the correct text
      expect(Number.isInteger(q.correct) && q.correct! >= 0 && q.correct! < 4, q.key).toBe(true);
      expect(q.explanation?.trim().length ?? 0, q.key).toBeGreaterThan(10);
    }
  });

  it('a test for a new skill picks 12 questions split 4/5/3', () => {
    const s = banks[0];
    const mix = resolveMix(s.test_mix, DEFAULT_TEST.mix);
    const pool = s.questions.map((q) => ({ id: q.key, type: q.type as 'mcq', difficulty: q.difficulty as 1 | 2 | 3 }));
    for (let seedNo = 1; seedNo <= 20; seedNo++) {
      const picked = pickQuestions(pool, { mix, maxCodingQuestions: 2 }, mulberry32(seedNo));
      expect(picked).toHaveLength(12);
      expect([1, 2, 3].map((d) => picked.filter((q) => q.difficulty === d).length)).toEqual([4, 5, 3]);
      expect(new Set(picked.map((q) => q.id)).size).toBe(12);
    }
  });

  it('docs/question-review.md is up to date with the seed (run `npm run questions:review`)', () => {
    const file = readFileSync(path.join(__dirname, '..', '..', 'docs', 'question-review.md'), 'utf8');
    expect(file.replace(/\r\n/g, '\n')).toBe(renderReview(seed));
  });

  it('skills without their own mix keep the global mix', () => {
    expect(resolveMix(undefined, DEFAULT_TEST.mix)).toEqual(DEFAULT_TEST.mix);
    expect(resolveMix({ easy: -1, medium: 5, hard: 3 }, DEFAULT_TEST.mix)).toEqual(DEFAULT_TEST.mix);
    expect(resolveMix({ easy: 0, medium: 0, hard: 0 }, DEFAULT_TEST.mix)).toEqual(DEFAULT_TEST.mix);
  });
});

describe('validateSeed catches broken banks', () => {
  const mk = (over: Partial<Q>[]): { skills: Skill[] } => {
    const qs: Q[] = Array.from({ length: 30 }, (_, i) => ({
      key: `t-${i}`, type: 'mcq', difficulty: i < 10 ? 1 : i < 22 ? 2 : 3, body: 'b', options: ['a', 'b', 'c', 'd'], correct: 0,
    }));
    over.forEach((o, i) => Object.assign(qs[i], o));
    return { skills: [{ slug: 't', test_mix: { easy: 4, medium: 5, hard: 3 }, questions: qs }] };
  };
  it('accepts a valid bank', () => expect(validateSeed(mk([]))).toEqual([]));
  it('flags duplicate ids', () => expect(validateSeed(mk([{ key: 'dup' }, { key: 'dup' }])).join()).toContain('duplicate key'));
  it('flags a missing or out-of-range correct option', () => {
    expect(validateSeed(mk([{ correct: 4 }])).join()).toContain('bad correct index');
    expect(validateSeed(mk([{ correct: undefined }])).join()).toContain('bad correct index');
  });
  it('flags duplicate options (two "correct" texts)', () => {
    expect(validateSeed(mk([{ options: ['a', 'a', 'c', 'd'] }])).join()).toContain('duplicate options');
  });
  it('flags invalid difficulty tags', () => expect(validateSeed(mk([{ difficulty: 4 }])).join()).toContain('difficulty must be 1, 2 or 3'));
  it('flags a test mix the bank cannot fill', () => {
    const bad = mk([]);
    bad.skills[0].test_mix = { easy: 11, medium: 5, hard: 3 };
    expect(validateSeed(bad).join()).toContain('bad test_mix');
  });
});

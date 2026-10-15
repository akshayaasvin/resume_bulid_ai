import { describe, expect, it } from 'vitest';
import { TECH_SKILL_GROUPS } from '@/lib/onboarding/catalog';
import { requiredTests } from '@/lib/flow';
import { normSkill } from '@/lib/skill-alias';
import {
  CLUSTERS, QUESTIONS_PER_CLUSTER, SELF_DECLARED, VERIFY_NOW_LIMIT, clusterOf, nextSkill, offeredClusters, planCluster,
  skillScores, skillStopped, type AnswerMark,
} from '@/lib/tests/clusters';
import { clusterResultText } from '@/lib/whatsapp/message';

const chips = new Set(TECH_SKILL_GROUPS.flatMap((g) => g.skills).map(normSkill));

describe('cluster config', () => {
  it('only uses skills that exist as chips, each in one place', () => {
    const all = [...CLUSTERS.flatMap((c) => c.skills), ...SELF_DECLARED];
    for (const s of all) expect(chips.has(normSkill(s)), s).toBe(true);
    expect(new Set(all.map(normSkill)).size).toBe(all.length);
  });
  it('maps skills (and aliases) to their group; MCQ-less skills are self-declared', () => {
    expect(clusterOf('Python')).toBe('programming');
    expect(clusterOf('js')).toBe('frontend');
    expect(clusterOf('k8s')).toBe('cloud');
    expect(clusterOf('Canva')).toBeNull();
    expect(clusterOf('PowerPoint')).toBeNull();
    expect(clusterOf('Typing')).toBeNull();
    expect(clusterOf('Basket weaving')).toBeNull();
  });
});

describe('offeredClusters', () => {
  it('offers only groups with a selected skill, largest first, rest self-declared', () => {
    const r = offeredClusters(['SQL', 'Excel', 'Pandas', 'Python', 'Canva', 'Docker']);
    expect(r.clusters.map((c) => c.id)).toEqual(['data', 'programming', 'cloud']);
    expect(r.clusters[0].skills).toEqual(['SQL', 'Excel', 'Pandas']);
    expect(r.selfDeclared).toEqual(['Canva']);
  });
  it('20 selected skills -> at most 3 group tests now (<= 45 questions), the rest later / self-declared', () => {
    const twenty = [
      'SQL', 'Excel', 'Pandas', 'NumPy', 'Power BI', 'Python', 'Java', 'C', 'Machine Learning', 'NLP',
      'AWS', 'Docker', 'Linux', 'HTML/CSS', 'JavaScript', 'Canva', 'Figma', 'MS Word', 'n8n', 'Cursor',
    ];
    const { clusters, selfDeclared } = offeredClusters(twenty);
    const now = clusters.slice(0, VERIFY_NOW_LIMIT);
    expect(now).toHaveLength(3);
    const questions = now.reduce((n, c) => n + planCluster(c.skills).reduce((m, p) => m + p.count, 0), 0);
    expect(questions).toBeLessThanOrEqual(3 * QUESTIONS_PER_CLUSTER);
    expect(questions).toBe(45);
    expect(selfDeclared).toEqual(['Canva', 'Figma', 'MS Word', 'n8n', 'Cursor']);
  });
});

describe('planCluster', () => {
  const totals = (p: { count: number }[]) => p.reduce((n, x) => n + x.count, 0);
  it('splits 15 questions evenly, min 3 per skill, at most 5 skills', () => {
    expect(planCluster(['A'])).toEqual([{ skill: 'A', count: 15 }]);
    expect(planCluster(['A', 'B']).map((p) => p.count)).toEqual([8, 7]);
    expect(planCluster(['A', 'B', 'C', 'D']).map((p) => p.count)).toEqual([4, 4, 4, 3]);
    expect(planCluster(['A', 'B', 'C', 'D', 'E']).map((p) => p.count)).toEqual([3, 3, 3, 3, 3]);
    const eight = planCluster(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    expect(eight.map((p) => p.skill)).toEqual(['A', 'B', 'C', 'D', 'E']);
    for (const n of [1, 2, 3, 4, 5, 6, 9]) {
      const p = planCluster(Array.from({ length: n }, (_, i) => `S${i}`));
      expect(totals(p)).toBe(15);
      expect(Math.min(...p.map((x) => x.count))).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('adaptive run', () => {
  const plan = [{ skill: 'SQL', count: 5 }, { skill: 'Excel', count: 5 }, { skill: 'Pandas', count: 5 }];

  it('asks skills round-robin', () => {
    const asked: string[] = [];
    const answers: AnswerMark[] = [];
    for (let i = 0; i < 3; i++) {
      const s = nextSkill(plan, answers)!;
      asked.push(s);
      answers.push({ skill: s, correct: true });
    }
    expect(asked).toEqual(['SQL', 'Excel', 'Pandas']);
  });

  it('stops a skill after 2 wrong answers in a row, and scores the rest as wrong', () => {
    const answers: AnswerMark[] = [];
    // Excel is always wrong; the others always right
    let guard = 0;
    for (let s = nextSkill(plan, answers); s && guard < 50; s = nextSkill(plan, answers), guard++) {
      answers.push({ skill: s, correct: s !== 'Excel' });
    }
    expect(answers.filter((a) => a.skill === 'Excel')).toHaveLength(2);
    expect(skillStopped('Excel', answers)).toBe(true);
    expect(answers).toHaveLength(12); // 5 + 2 + 5, under the 15 planned
    expect(skillScores(plan, answers)).toEqual({ SQL: 100, Excel: 0, Pandas: 100 });
    expect(nextSkill(plan, answers)).toBeNull();
  });

  it('wrong, right, wrong does not stop (not consecutive)', () => {
    const a: AnswerMark[] = [{ skill: 'SQL', correct: false }, { skill: 'SQL', correct: true }, { skill: 'SQL', correct: false }];
    expect(skillStopped('SQL', a)).toBe(false);
    expect(skillScores([{ skill: 'SQL', count: 3 }], a)).toEqual({ SQL: 33.33 });
  });
});

describe('results', () => {
  it('a candidate with only self-declared skills is never blocked', () => {
    expect(requiredTests({ testable: 0, waiting: 0, unavailable: 0, selfDeclared: 3 })).toBe(0);
    expect(requiredTests({ testable: 2, waiting: 0, unavailable: 0, selfDeclared: 3 })).toBe(2);
  });
  it('the WhatsApp result lists only verified skills (no below-threshold numbers)', () => {
    expect(clusterResultText({ SQL: 80, Excel: 33.33, Pandas: 66.67 }, 50)).toBe('Verified - SQL 80%, Pandas 67%');
    const none = clusterResultText({ SQL: 20, Excel: 40 }, 50);
    expect(none).toMatch(/keep practising/i);
    expect(none).not.toMatch(/\d/);
  });
});

import { describe, expect, it } from 'vitest';
import { computeStep, gateRedirect, laterStep, requiredTests, stepForPath } from '@/lib/flow';
import { headerLines } from '@/lib/resume/snapshot';

const avail = (testable: number, waiting = 0, unavailable = 0) => ({ testable, waiting, unavailable });

describe('requiredTests', () => {
  it('is 3, or every testable declared skill when fewer', () => {
    expect(requiredTests(avail(5))).toBe(3);
    expect(requiredTests(avail(3))).toBe(3);
    expect(requiredTests(avail(2, 4))).toBe(2);
    expect(requiredTests(avail(1, 0, 2))).toBe(1);
  });
  it('needs one (generated) test when declared skills only lack a test so far', () => {
    expect(requiredTests(avail(0, 3))).toBe(1); // e.g. AutoCAD, MS Word before generation
    expect(requiredTests(avail(0, 1, 2))).toBe(1);
  });
  it('is never a dead end: nothing required when no declared skill can get a test', () => {
    expect(requiredTests(avail(0, 0, 3))).toBe(0);
  });
  it('asks for any catalogue test when no skills are declared', () => {
    expect(requiredTests(avail(0))).toBe(1);
  });
});

describe('computeStep', () => {
  it('keeps the candidate in the wizard until it is finished', () => {
    expect(computeStep({ wizardStep: 3, completedTests: 9, ...avail(3) })).toBe('wizard');
  });
  it('requires the minimum number of tests', () => {
    expect(computeStep({ wizardStep: 4, completedTests: 2, ...avail(4) })).toBe('tests');
    expect(computeStep({ wizardStep: 4, completedTests: 3, ...avail(4) })).toBe('done');
    expect(computeStep({ wizardStep: 4, completedTests: 2, ...avail(2) })).toBe('done');
    expect(computeStep({ wizardStep: 4, completedTests: 0, ...avail(0) })).toBe('tests');
  });
  it('AutoCAD + MS Word with no bank: one generated test unlocks job matches', () => {
    expect(computeStep({ wizardStep: 4, completedTests: 0, ...avail(0, 2) })).toBe('tests');
    expect(computeStep({ wizardStep: 4, completedTests: 1, ...avail(1, 1) })).toBe('done');
  });
  it('unlocks when generation failed for every declared skill', () => {
    expect(computeStep({ wizardStep: 4, completedTests: 0, ...avail(0, 0, 2) })).toBe('done');
  });
});

describe('laterStep', () => {
  it('never moves a candidate backwards', () => {
    expect(laterStep('done', 'tests')).toBe('done');
    expect(laterStep('tests', 'done')).toBe('done');
    expect(laterStep(null, 'wizard')).toBe('wizard');
  });
});

describe('stepForPath', () => {
  it('maps funnel pages to their step and ignores everything else', () => {
    expect(stepForPath('/wizard')).toBe('wizard');
    expect(stepForPath('/test')).toBe('tests');
    expect(stepForPath('/test/python')).toBe('tests');
    expect(stepForPath('/results')).toBe('tests');
    expect(stepForPath('/dashboard')).toBe('done');
    expect(stepForPath('/resume')).toBe('done');
    expect(stepForPath('/')).toBeNull();
    expect(stepForPath('/login')).toBeNull();
    expect(stepForPath('/testing')).toBeNull(); // prefix match must respect path segments
  });
});

describe('gateRedirect', () => {
  it('sends candidates forward-jumping to their current step', () => {
    expect(gateRedirect('wizard', '/test/python')).toBe('/wizard');
    expect(gateRedirect('wizard', '/dashboard')).toBe('/wizard');
    expect(gateRedirect('tests', '/resume')).toBe('/test');
  });
  it('allows the current step and earlier steps', () => {
    expect(gateRedirect('tests', '/test')).toBeNull();
    expect(gateRedirect('tests', '/wizard')).toBeNull();
    expect(gateRedirect('done', '/test/sql')).toBeNull();
    expect(gateRedirect('done', '/resume')).toBeNull();
  });
  it('never gates pages outside the funnel or unknown steps', () => {
    expect(gateRedirect('wizard', '/login')).toBeNull();
    expect(gateRedirect(null, '/dashboard')).toBeNull();
  });
});

describe('headerLines', () => {
  it('drops a Tamil-name line that just repeats the name', () => {
    expect(headerLines({ name: 'Priya S', nameTamil: ' priya  s ', headline: null })).toEqual({ headline: null, nameTamil: null });
  });
  it('drops a headline equal to the name, keeps a real role', () => {
    expect(headerLines({ name: 'Priya S', nameTamil: null, headline: 'Priya S' }).headline).toBeNull();
    expect(headerLines({ name: 'Priya S', nameTamil: 'பிரியா', headline: 'Data Analyst' })).toEqual({ headline: 'Data Analyst', nameTamil: 'பிரியா' });
  });
  it('handles older snapshots without a headline', () => {
    expect(headerLines({ name: 'Priya S', nameTamil: 'பிரியா' })).toEqual({ headline: null, nameTamil: 'பிரியா' });
  });
});

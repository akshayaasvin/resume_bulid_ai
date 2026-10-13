import { describe, expect, it } from 'vitest';
import { computeStep, gateRedirect, laterStep, requiredTests, stepForPath } from '@/lib/flow';
import { headerLines } from '@/lib/resume/snapshot';

describe('requiredTests', () => {
  it('is 3, or every testable declared skill when fewer, but at least 1', () => {
    expect(requiredTests(5)).toBe(3);
    expect(requiredTests(3)).toBe(3);
    expect(requiredTests(2)).toBe(2);
    expect(requiredTests(1)).toBe(1);
    expect(requiredTests(0)).toBe(1);
  });
});

describe('computeStep', () => {
  it('keeps the candidate in the wizard until it is finished', () => {
    expect(computeStep({ wizardStep: 3, completedTests: 9, testableDeclared: 3 })).toBe('wizard');
  });
  it('requires the minimum number of tests', () => {
    expect(computeStep({ wizardStep: 4, completedTests: 2, testableDeclared: 4 })).toBe('tests');
    expect(computeStep({ wizardStep: 4, completedTests: 3, testableDeclared: 4 })).toBe('done');
    expect(computeStep({ wizardStep: 4, completedTests: 2, testableDeclared: 2 })).toBe('done');
    expect(computeStep({ wizardStep: 4, completedTests: 0, testableDeclared: 0 })).toBe('tests');
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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { educationValid, isValidScore, sanitizeScoreInput, validateEducation, yearMax } from '@/lib/education-validation';
import { putJson } from '@/lib/useAutosave';

const NOW = new Date('2026-10-15T00:00:00Z'); // max year = 2032
const row = (o: Partial<Parameters<typeof validateEducation>[0]> = {}) => ({
  institution: 'PSG College of Technology', degree: 'B.E.', field: 'CSE', start_year: 2022, end_year: 2026, score: '8.4', ...o,
});

describe('validateEducation', () => {
  it('accepts a complete, sensible row', () => {
    expect(validateEducation(row(), NOW)).toEqual({});
  });

  it('ignores a blank card', () => {
    expect(validateEducation({ institution: '', degree: '', field: '', start_year: null, end_year: null, score: '' }, NOW)).toEqual({});
  });

  it('requires college and degree with at least 2 characters', () => {
    expect(validateEducation(row({ institution: '  ' }), NOW).institution).toBe('required');
    expect(validateEducation(row({ degree: 'B' }), NOW).degree).toBe('tooShort');
  });

  it('only accepts 4-digit years from 1970 to current year + 6', () => {
    expect(yearMax(NOW)).toBe(2032);
    expect(validateEducation(row({ start_year: 2 }), NOW).start_year).toBe('year'); // half-typed
    expect(validateEducation(row({ start_year: 202 }), NOW).start_year).toBe('year');
    expect(validateEducation(row({ start_year: 1969 }), NOW).start_year).toBe('year');
    expect(validateEducation(row({ end_year: 2033 }), NOW).end_year).toBe('year');
    expect(validateEducation(row({ start_year: 1970, end_year: 2032 }), NOW)).toEqual({});
    expect(validateEducation(row({ start_year: null, end_year: null }), NOW)).toEqual({}); // years are optional
  });

  it('requires end year >= start year', () => {
    expect(validateEducation(row({ start_year: 2024, end_year: 2022 }), NOW).end_year).toBe('yearOrder');
    expect(validateEducation(row({ start_year: 2024, end_year: 2024 }), NOW)).toEqual({});
  });

  it('flags a non-numeric or out-of-range CGPA / %', () => {
    expect(validateEducation(row({ score: 'Gh' }), NOW).score).toBe('score');
    expect(validateEducation(row({ score: '101' }), NOW).score).toBe('score');
  });

  it('educationValid is true only when every filled card is valid', () => {
    expect(educationValid([row(), row({ institution: '', degree: '', field: '', start_year: null, end_year: null, score: '' })], NOW)).toBe(true);
    expect(educationValid([row(), row({ start_year: 20 })], NOW)).toBe(false);
  });
});

describe('isValidScore', () => {
  it.each(['8.4', '10', '0', '85', '85.5', '100', '92%', '7.25'])('accepts %s', (s) => expect(isValidScore(s)).toBe(true));
  it.each(['8.2 CGPA', '8.2CGPA', '8.2 cgpa', '9 GPA', '9gpa', '85 %', '85%', ' 7.5 Cgpa '])(
    'accepts a suffix: %s', (s) => expect(isValidScore(s)).toBe(true));
  it.each(['Gh', '101', '-1', '8..4', '1000', '8.456', '', '%', 'CGPA', '8.2 CG', '8.2 CGPA %', '8.2 marks', '85 CGPA', '11 GPA', '101 %'])(
    'rejects %s', (s) => expect(isValidScore(s)).toBe(false));
});

describe('sanitizeScoreInput (CGPA / % field filter)', () => {
  it('keeps digits, dot, %, spaces and the letters of CGPA / GPA as typed', () => {
    expect(sanitizeScoreInput('8.2 CGPA')).toBe('8.2 CGPA');
    expect(sanitizeScoreInput('9 gpa')).toBe('9 gpa');
    expect(sanitizeScoreInput('85 %')).toBe('85 %');
  });
  it('blocks other letters and symbols', () => {
    expect(sanitizeScoreInput('Gh')).toBe('G'); // G is a suffix letter; validation still rejects 'G'
    expect(isValidScore(sanitizeScoreInput('Gh'))).toBe(false);
    expect(sanitizeScoreInput('xyz')).toBe('');
    expect(sanitizeScoreInput('8.2 marks!')).toBe('8.2 a');
    expect(sanitizeScoreInput('85/100')).toBe('85100');
  });
  it('every value a user can type through the filter is judged by isValidScore, not rewritten', () => {
    const typed = '8.2 CGPA';
    expect(sanitizeScoreInput(typed)).toBe(typed);
    expect(validateEducation(row({ score: typed }), NOW)).toEqual({});
  });
});

describe('putJson save results', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stubFetch = (impl: () => Promise<Response>) => vi.stubGlobal('fetch', vi.fn(impl));

  it('2xx is ok', async () => {
    stubFetch(async () => new Response('{}', { status: 200 }));
    expect(await putJson('/api/wizard', {})).toBe('ok');
  });
  it('a network failure (TypeError) is offline, not an error', async () => {
    stubFetch(async () => { throw new TypeError('Failed to fetch'); });
    expect(await putJson('/api/wizard', {})).toBe('offline');
  });
  it('a 400 is rejected and is logged with status and body', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch(async () => new Response('{"error":"invalid_input"}', { status: 400 }));
    expect(await putJson('/api/wizard', {})).toBe('rejected');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 400'), expect.stringContaining('invalid_input'));
    warn.mockRestore();
  });
  it('401/500 are errors, not offline', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch(async () => new Response('', { status: 401 }));
    expect(await putJson('/api/wizard', {})).toBe('error');
    stubFetch(async () => new Response('', { status: 500 }));
    expect(await putJson('/api/wizard', {})).toBe('error');
    warn.mockRestore();
  });
});

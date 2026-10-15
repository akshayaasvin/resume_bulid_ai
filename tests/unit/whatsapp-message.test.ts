import { describe, expect, it } from 'vitest';
import { maskPhone, skillScoreParams, toWaNumber } from '@/lib/whatsapp/message';

describe('maskPhone', () => {
  it('keeps only the last 4 digits', () => {
    expect(maskPhone('+919876543210')).toBe('********3210');
    expect(maskPhone('98765 43210')).toBe('******3210');
  });
  it('fully masks short or missing numbers', () => {
    expect(maskPhone('123')).toBe('****');
    expect(maskPhone(null)).toBe('****');
  });
});

describe('toWaNumber', () => {
  it('adds the India country code to a 10-digit mobile number', () => {
    expect(toWaNumber('9876543210')).toBe('919876543210');
  });
  it('accepts +91 numbers with spaces or dashes', () => {
    expect(toWaNumber('+91 98765 43210')).toBe('919876543210');
    expect(toWaNumber('+91-98765-43210')).toBe('919876543210');
  });
  it('rejects invalid numbers', () => {
    expect(toWaNumber('12345')).toBeNull();
    expect(toWaNumber('abcdefghij')).toBeNull();
    expect(toWaNumber('1234567890')).toBeNull(); // 10 digits but not a mobile (must start 6-9)
  });
});

describe('skillScoreParams', () => {
  const base = { name: 'Priya Subramanian', skill: 'SQL', threshold: 50, resumeUrl: 'https://x.app/resume', ctaUrl: 'https://x.app/roles' };

  it('returns {{1}}..{{5}}: first name, skill, result, resume link, next-step link', () => {
    expect(skillScoreParams({ ...base, scorePct: 86.4 })).toEqual(['Priya', 'SQL', 'Verified - 86%', 'https://x.app/resume', 'https://x.app/roles']);
  });
  it('shows the % at exactly the threshold', () => {
    expect(skillScoreParams({ ...base, scorePct: 50 })[2]).toBe('Verified - 50%');
  });
  it('never puts a below-threshold score in the message', () => {
    for (const scorePct of [0, 12, 42.7, 49.9]) {
      const result = skillScoreParams({ ...base, scorePct })[2];
      expect(result).toMatch(/keep practising/i);
      expect(result).not.toMatch(/\d/);
    }
  });
  it('uses the first name, or a fallback for a blank name', () => {
    expect(skillScoreParams({ ...base, name: '  Arun   Kumar ', scorePct: 70 })[0]).toBe('Arun');
    expect(skillScoreParams({ ...base, name: '   ', scorePct: 70 })[0]).toBe('there');
  });
});

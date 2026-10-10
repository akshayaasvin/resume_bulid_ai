import { describe, expect, it } from 'vitest';
import { currentPin, currentWindow, lockedUntil, pinForWindow, verifyPin } from '@/lib/test-engine/pin';

const ws = { pin_secret: 'a'.repeat(64), is_demo: false, demo_pin: null };
const ROT = 30;
const at = (iso: string) => new Date(iso);

describe('rotating PIN', () => {
  it('is 6 digits and stable within a window', () => {
    const a = currentPin(ws.pin_secret, at('2026-03-01T10:00:00Z'), ROT);
    const b = currentPin(ws.pin_secret, at('2026-03-01T10:29:59Z'), ROT);
    expect(a.pin).toMatch(/^\d{6}$/);
    expect(a.pin).toBe(b.pin);
    expect(a.expiresAt.toISOString()).toBe('2026-03-01T10:30:00.000Z');
  });

  it('changes every 30 minutes and differs per workshop secret', () => {
    const pins = new Set(Array.from({ length: 20 }, (_, i) => pinForWindow(ws.pin_secret, 1000 + i)));
    expect(pins.size).toBeGreaterThan(15);
    expect(pinForWindow('secret-1', 5)).not.toBe(pinForWindow('secret-2', 5));
  });

  it('verifies the current PIN and rejects others', () => {
    const now = at('2026-03-01T10:10:00Z');
    const pin = currentPin(ws.pin_secret, now, ROT).pin;
    expect(verifyPin(ws, pin, now, ROT)).toBe(true);
    expect(verifyPin(ws, ` ${pin} `, now, ROT)).toBe(true);
    expect(verifyPin(ws, pin === '000000' ? '111111' : '000000', now, ROT)).toBe(false);
    expect(verifyPin(ws, '12345', now, ROT)).toBe(false);
  });

  it('accepts the previous PIN only during the first 2 minutes after rotation', () => {
    const before = at('2026-03-01T10:29:30Z');
    const oldPin = currentPin(ws.pin_secret, before, ROT).pin;
    expect(verifyPin(ws, oldPin, at('2026-03-01T10:31:00Z'), ROT)).toBe(true);
    expect(verifyPin(ws, oldPin, at('2026-03-01T10:33:00Z'), ROT)).toBe(false);
  });

  it('demo workshops use their fixed PIN only', () => {
    const demo = { ...ws, is_demo: true, demo_pin: '1234' };
    const now = at('2026-03-01T10:00:00Z');
    expect(verifyPin(demo, '1234', now, ROT)).toBe(true);
    expect(verifyPin(demo, currentPin(ws.pin_secret, now, ROT).pin, now, ROT)).toBe(false);
  });

  it('currentWindow math', () => {
    expect(currentWindow(new Date(0), 30)).toBe(0);
    expect(currentWindow(new Date(30 * 60_000), 30)).toBe(1);
  });
});

describe('lockedUntil', () => {
  const now = at('2026-03-01T10:00:00Z');
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);

  it('4 failures: not locked', () => {
    expect(lockedUntil([ago(1), ago(2), ago(3), ago(4)], now, 5, 10)).toBeNull();
  });
  it('5 failures within 10 minutes: locked for 10 minutes from the last one', () => {
    const until = lockedUntil([ago(1), ago(2), ago(3), ago(4), ago(5)], now, 5, 10);
    expect(until?.toISOString()).toBe(new Date(ago(1).getTime() + 10 * 60_000).toISOString());
  });
  it('old failures outside the window do not count', () => {
    expect(lockedUntil([ago(1), ago(2), ago(11), ago(12), ago(13)], now, 5, 10)).toBeNull();
  });
  it('lock expires', () => {
    expect(lockedUntil([ago(10.5), ago(10.6), ago(10.7), ago(10.8), ago(10.9)], now, 5, 10)).toBeNull();
  });
});

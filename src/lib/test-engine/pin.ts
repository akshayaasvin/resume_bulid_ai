import { createHmac, timingSafeEqual } from 'node:crypto';

/** 6-digit PIN for a given 30-minute window, derived from the workshop's pin_secret. */
export function pinForWindow(secret: string, window: number): string {
  const mac = createHmac('sha256', secret).update(`pin:${window}`).digest();
  const n = mac.readUInt32BE(0) % 1_000_000;
  return n.toString().padStart(6, '0');
}

export function currentWindow(now: Date, rotateMinutes: number): number {
  return Math.floor(now.getTime() / (rotateMinutes * 60_000));
}

export function currentPin(secret: string, now: Date, rotateMinutes: number) {
  const w = currentWindow(now, rotateMinutes);
  const windowMs = rotateMinutes * 60_000;
  return {
    pin: pinForWindow(secret, w),
    expiresAt: new Date((w + 1) * windowMs),
  };
}

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export interface PinWorkshop {
  pin_secret: string;
  is_demo: boolean;
  demo_pin: string | null;
}

/**
 * Accepts the current window's PIN, plus the previous window's PIN for the first 2 minutes
 * after a rotation (students who started typing just before it changed).
 */
export function verifyPin(ws: PinWorkshop, entered: string, now: Date, rotateMinutes: number): boolean {
  const pin = entered.trim();
  if (ws.is_demo && ws.demo_pin) return safeEq(pin, ws.demo_pin);
  if (!/^\d{6}$/.test(pin)) return false;
  const w = currentWindow(now, rotateMinutes);
  if (safeEq(pin, pinForWindow(ws.pin_secret, w))) return true;
  const sinceRotation = now.getTime() - w * rotateMinutes * 60_000;
  return sinceRotation <= 2 * 60_000 && safeEq(pin, pinForWindow(ws.pin_secret, w - 1));
}

/**
 * Lockout: N wrong tries (per device OR per account) within the lock window -> locked until
 * the oldest of those tries + lock window. `failures` are timestamps of recent failed tries,
 * already filtered to "since the last success".
 */
export function lockedUntil(failures: Date[], now: Date, maxWrong: number, lockMinutes: number): Date | null {
  const windowMs = lockMinutes * 60_000;
  const recent = failures
    .filter((d) => now.getTime() - d.getTime() < windowMs)
    .sort((a, b) => b.getTime() - a.getTime());
  if (recent.length < maxWrong) return null;
  // Tries made while locked are rejected without being logged, so the most recent failure
  // is the one that tripped the lock.
  const until = new Date(recent[0].getTime() + windowMs);
  return until > now ? until : null;
}

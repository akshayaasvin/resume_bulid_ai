import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { serverEnv } from './env';

const COOKIE = 'rb_proctor';
const TTL_MS = 12 * 60 * 60 * 1000;

function sign(payload: string) {
  return createHmac('sha256', serverEnv('APP_SECRET')).update(payload).digest('base64url');
}

/** Proctors are not Supabase users: a signed, workshop-scoped cookie after password login. */
export function setProctorSession(workshopId: string) {
  const payload = Buffer.from(JSON.stringify({ w: workshopId, exp: Date.now() + TTL_MS })).toString('base64url');
  cookies().set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: TTL_MS / 1000, path: '/',
  });
}

export function proctorWorkshopId(): string | null {
  const raw = cookies().get(COOKIE)?.value;
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { w, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { w: string; exp: number };
    return exp > Date.now() ? w : null;
  } catch {
    return null;
  }
}

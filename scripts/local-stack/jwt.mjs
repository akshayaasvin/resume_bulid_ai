// Minimal HS256 JWT helpers for the local stand-in stack (PostgREST verifies the same secret).
import { createHmac, timingSafeEqual } from 'node:crypto';

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

export function sign(payload, secret) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export function verify(token, secret) {
  const [head, body, sig] = String(token ?? '').split('.');
  if (!head || !body || !sig) return null;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url'));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  return payload;
}

export function apiKeys(secret) {
  const far = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600;
  return {
    anon: sign({ role: 'anon', iss: 'local-stack', exp: far }, secret),
    service: sign({ role: 'service_role', iss: 'local-stack', exp: far }, secret),
  };
}

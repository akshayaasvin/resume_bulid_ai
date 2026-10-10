import { cookies } from 'next/headers';
import { TestError } from '@/lib/test-engine/service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function deviceId(): string {
  const v = cookies().get('rb_device')?.value ?? '';
  return UUID_RE.test(v) ? v : '00000000-0000-0000-0000-000000000000';
}

export function isUuid(v: string) {
  return UUID_RE.test(v);
}

export function errorResponse(e: unknown) {
  if (e instanceof TestError) return Response.json({ error: e.code, ...e.extra }, { status: e.status });
  console.error(e);
  return Response.json({ error: 'server_error' }, { status: 500 });
}

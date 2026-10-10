'use client';
import { del, get, set, update } from 'idb-keyval';

/** Local persistence for in-progress tests so a WiFi drop or reload never loses answers. */
export type LocalAnswers = Record<string, unknown>;

const answersKey = (id: string) => `attempt:${id}:answers`;
const dataKey = (id: string) => `attempt:${id}:data`;
const PENDING = 'pending-submits';

export async function saveLocalAnswers(attemptId: string, answers: LocalAnswers) {
  try { await set(answersKey(attemptId), { answers, updatedAt: Date.now() }); } catch { /* private mode etc. */ }
}

export async function loadLocalAnswers(attemptId: string): Promise<LocalAnswers | null> {
  try {
    const v = await get<{ answers: LocalAnswers }>(answersKey(attemptId));
    return v?.answers ?? null;
  } catch {
    return null;
  }
}

export async function cacheAttemptData<T>(attemptId: string, data: T) {
  try { await set(dataKey(attemptId), data); } catch { /* ignore */ }
}

export async function loadCachedAttemptData<T>(attemptId: string): Promise<T | null> {
  try { return (await get<T>(dataKey(attemptId))) ?? null; } catch { return null; }
}

export async function addPendingSubmit(attemptId: string) {
  try { await update<string[]>(PENDING, (v) => Array.from(new Set([...(v ?? []), attemptId]))); } catch { /* ignore */ }
}

export async function getPendingSubmits(): Promise<string[]> {
  try { return (await get<string[]>(PENDING)) ?? []; } catch { return []; }
}

export async function clearAttempt(attemptId: string) {
  try {
    await del(answersKey(attemptId));
    await del(dataKey(attemptId));
    await update<string[]>(PENDING, (v) => (v ?? []).filter((x) => x !== attemptId));
  } catch { /* ignore */ }
}

/** POST a submission; resolves the parsed body on success, null on network/server failure. */
export async function trySubmit(attemptId: string, answers: LocalAnswers) {
  try {
    const res = await fetch(`/api/test/${attemptId}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers }),
    });
    if (res.status === 404) return { gone: true as const };
    if (!res.ok) return null;
    return (await res.json()) as { scorePct: number; level: string; badge: string; flagged: boolean };
  } catch {
    return null;
  }
}

/** Retries until success, with exponential backoff capped at 30 s; also wakes on `online`. */
export async function submitWithRetry(
  attemptId: string,
  answers: LocalAnswers,
  onRetry?: (n: number) => void,
  signal?: { cancelled: boolean },
) {
  await addPendingSubmit(attemptId);
  for (let n = 0; ; n++) {
    if (signal?.cancelled) return null;
    const r = await trySubmit(attemptId, answers);
    if (r) {
      await clearAttempt(attemptId);
      return r;
    }
    onRetry?.(n + 1);
    const wait = Math.min(30_000, 1000 * 2 ** n) + Math.random() * 500;
    await new Promise<void>((resolve) => {
      const t = setTimeout(done, wait);
      function done() {
        clearTimeout(t);
        window.removeEventListener('online', done);
        resolve();
      }
      window.addEventListener('online', done, { once: true });
    });
  }
}

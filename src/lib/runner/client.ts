'use client';
import { publicEnv } from '../env';

export type RunnerKind = 'python' | 'sql';
export type RunnerStatus = 'idle' | 'loading' | 'ready' | 'error';

export const RUN_TIMEOUT_MS = 8_000;

export interface PyResult { stdout: string; outputs: (string | null)[]; error: string | null }
export interface SqlResult { columns: string[]; values: unknown[][] }
export type RunOutcome<T> = { ok: true; result: T } | { ok: false; error: string; timeout?: boolean };

interface Slot {
  worker: Worker | null;
  ready: Promise<void> | null;
  status: RunnerStatus;
  seq: number;
  pending: Map<number, (msg: { ok: boolean; result?: unknown; error?: string }) => void>;
}

const slots: Record<RunnerKind, Slot> = {
  python: { worker: null, ready: null, status: 'idle', seq: 0, pending: new Map() },
  sql: { worker: null, ready: null, status: 'idle', seq: 0, pending: new Map() },
};
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getStatus(kind: RunnerKind): RunnerStatus {
  return slots[kind].status;
}

const base = (kind: RunnerKind) => (kind === 'python' ? publicEnv.pyodideBaseUrl : publicEnv.sqljsBaseUrl);

function send(kind: RunnerKind, msg: Record<string, unknown>) {
  const slot = slots[kind];
  const id = ++slot.seq;
  return {
    id,
    promise: new Promise<{ ok: boolean; result?: unknown; error?: string }>((resolve) => {
      slot.pending.set(id, resolve);
      slot.worker!.postMessage({ ...msg, id, base: base(kind) });
    }),
  };
}

function spawn(kind: RunnerKind) {
  const slot = slots[kind];
  const w = new Worker(kind === 'python' ? '/workers/py-worker.js' : '/workers/sql-worker.js');
  w.onmessage = (e) => {
    const cb = slot.pending.get(e.data.id);
    if (cb) {
      slot.pending.delete(e.data.id);
      cb(e.data);
    }
  };
  w.onerror = () => {
    slot.status = 'error';
    emit();
  };
  slot.worker = w;
  slot.status = 'loading';
  emit();
  slot.ready = send(kind, { type: 'init' }).promise.then((r) => {
    slot.status = r.ok ? 'ready' : 'error';
    emit();
    if (!r.ok) {
      kill(kind);
      throw new Error(r.error ?? 'runner failed to load');
    }
  });
  slot.ready.catch(() => undefined);
}

function kill(kind: RunnerKind) {
  const slot = slots[kind];
  slot.worker?.terminate();
  slot.worker = null;
  slot.ready = null;
  slot.pending.forEach((cb) => cb({ ok: false, error: 'terminated' }));
  slot.pending.clear();
  slot.status = 'idle';
  emit();
}

/** Start downloading + initialising the runtime in the background. Safe to call repeatedly. */
export function prefetch(kind: RunnerKind) {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return;
  if (!slots[kind].worker) spawn(kind);
}

async function run<T>(kind: RunnerKind, msg: Record<string, unknown>): Promise<RunOutcome<T>> {
  prefetch(kind);
  try {
    await slots[kind].ready;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const { promise } = send(kind, msg);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<RunOutcome<T>>((resolve) => {
    timer = setTimeout(() => {
      // Infinite loop or runaway code: the only reliable stop is killing the worker.
      kill(kind);
      prefetch(kind);
      resolve({ ok: false, error: 'timeout', timeout: true });
    }, RUN_TIMEOUT_MS);
  });
  const result = promise.then((r): RunOutcome<T> => (r.ok ? { ok: true, result: r.result as T } : { ok: false, error: r.error ?? 'error' }));
  const out = await Promise.race([result, timeout]);
  clearTimeout(timer);
  return out;
}

export function runPython(code: string, calls: string[]) {
  return run<PyResult>('python', { type: 'run', code, calls });
}

export function runSql(seed: string, query: string) {
  return run<SqlResult>('sql', { type: 'run', seed, query });
}

'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/** What a save attempt returned. Only 'offline' is retried automatically. */
export type SaveResult = 'ok' | 'offline' | 'rejected' | 'error';
export type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'rejected' | 'error';

/**
 * PUT helper for autosave: network failures (fetch TypeError) are 'offline'; a 400 means the
 * server rejected the data; any other non-2xx is 'error'. Logs the real response for debugging.
 */
export async function putJson(url: string, body: unknown): Promise<SaveResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  let res: Response;
  try {
    res = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    return 'offline'; // TypeError: network unreachable
  }
  if (res.ok) return 'ok';
  const detail = await res.text().catch(() => '');
  console.warn(`autosave ${url} failed: HTTP ${res.status}`, detail.slice(0, 500));
  return res.status === 400 ? 'rejected' : 'error';
}

/**
 * Debounced autosave with a localStorage draft.
 * - offline: the draft stays on the phone and is retried on `online`, on app load (restored
 *   draft) and whenever the caller flushes (e.g. on step change).
 * - rejected/error: shown to the user and NOT retried in a loop; the draft is kept on the phone.
 * - canSave: data that fails client validation is kept locally but never sent.
 */
export function useAutosave<T>(
  key: string,
  save: (data: T) => Promise<SaveResult>,
  opts: { delay?: number; canSave?: (data: T) => boolean } = {},
) {
  const { delay = 1200 } = opts;
  const [state, setState] = useState<SaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const latest = useRef<T | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  const canSaveRef = useRef(opts.canSave);
  canSaveRef.current = opts.canSave;

  const flush = useCallback(async (): Promise<SaveResult | null> => {
    clearTimeout(timer.current);
    const data = latest.current;
    if (data == null) return null;
    if (canSaveRef.current && !canSaveRef.current(data)) {
      setState('idle'); // invalid: wait for the candidate to fix it; inline errors explain why
      return null;
    }
    setState('saving');
    let result: SaveResult;
    try {
      result = await saveRef.current(data);
    } catch {
      result = 'error';
    }
    if (latest.current === data) {
      if (result === 'ok') {
        latest.current = null;
        try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
      } else if (result !== 'offline') {
        latest.current = null; // don't retry a rejected payload forever; the draft stays on the phone
      }
    }
    setState(result === 'ok' ? 'saved' : result);
    return result;
  }, [key]);

  const queue = useCallback((data: T) => {
    latest.current = data;
    try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* storage unavailable */ }
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  }, [key, delay, flush]);

  useEffect(() => {
    const retry = () => { if (latest.current != null) void flush(); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') retry(); };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(timer.current);
    };
  }, [flush]);

  const readDraft = useCallback((): T | null => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }, [key]);

  return { state, queue, flush, readDraft };
}

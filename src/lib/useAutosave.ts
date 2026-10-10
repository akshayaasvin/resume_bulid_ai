'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

/**
 * Debounced autosave with a localStorage draft. If the network fails the draft stays on the
 * phone and is retried on the `online` event or the next change.
 */
export function useAutosave<T>(key: string, save: (data: T) => Promise<boolean>, delay = 1200) {
  const [state, setState] = useState<SaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const latest = useRef<T | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const data = latest.current;
    if (data == null) return true;
    setState('saving');
    let ok = false;
    try {
      ok = await saveRef.current(data);
    } catch {
      ok = false;
    }
    if (ok && latest.current === data) {
      latest.current = null;
      try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
    }
    setState(ok ? 'saved' : navigator.onLine ? 'error' : 'offline');
    return ok;
  }, [key]);

  const queue = useCallback((data: T) => {
    latest.current = data;
    try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* storage unavailable */ }
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  }, [key, delay, flush]);

  useEffect(() => {
    const onOnline = () => { if (latest.current != null) void flush(); };
    const onHide = () => { if (latest.current != null) void flush(); };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onHide);
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

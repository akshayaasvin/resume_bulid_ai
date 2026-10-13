'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n/client';
import type { ClientQuestion } from '@/lib/test-engine/questions';
import {
  cacheAttemptData, loadCachedAttemptData, loadLocalAnswers, saveLocalAnswers, submitWithRetry,
} from '@/lib/test-engine/offline';
import { CodeQuestion } from './CodeQuestion';

interface AttemptPayload {
  attempt: {
    id: string; skill: { slug: string; name: string }; mode: 'self' | 'campus';
    status: 'in_progress' | 'submitted' | 'expired'; startedAt: string; expiresAt: string; graceMinutes: number;
    tabSwitches: number; fullscreenExits: number; flagged: boolean;
  };
  questions: ClientQuestion[];
  answers: Record<string, unknown>;
  serverNow: string;
}

type Answers = Record<string, unknown>;

function fmt(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function TestRunner({ attemptId, skillName, skillSlug }: { attemptId: string; skillName: string; skillSlug: string }) {
  const { t } = useT();
  const router = useRouter();
  const [data, setData] = useState<AttemptPayload | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [answers, setAnswers] = useState<Answers>({});
  const [idx, setIdx] = useState(0);
  const [offset, setOffset] = useState(0); // serverNow - clientNow
  const [now, setNow] = useState(Date.now());
  const [warning, setWarning] = useState<string | null>(null);
  const [counters, setCounters] = useState({ tab: 0, fullscreen: 0, flagged: false });
  const [submitting, setSubmitting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(true);
  const answersRef = useRef<Answers>({});
  const staleCode = useRef<Set<string>>(new Set());
  const submittedRef = useRef(false);
  const away = useRef(false);
  const cancel = useRef({ cancelled: false });

  // ---- load (network first, IndexedDB fallback) ----
  useEffect(() => {
    let alive = true;
    const cancelSignal = cancel.current;
    (async () => {
      let payload: AttemptPayload | null = null;
      try {
        const res = await fetch(`/api/test/${attemptId}`, { cache: 'no-store' });
        if (res.ok) {
          payload = await res.json();
          await cacheAttemptData(attemptId, payload);
        } else if (res.status === 404) {
          router.replace('/test');
          return;
        }
      } catch { /* offline */ }
      payload ??= await loadCachedAttemptData<AttemptPayload>(attemptId);
      if (!alive) return;
      if (!payload) { setLoadError(true); return; }
      if (payload.attempt.status !== 'in_progress') {
        router.replace(`/results?attempt=${attemptId}`);
        return;
      }
      const local = (await loadLocalAnswers(attemptId)) ?? {};
      const merged = { ...payload.answers, ...local };
      answersRef.current = merged;
      setAnswers(merged);
      setOffset(new Date(payload.serverNow).getTime() - Date.now());
      setCounters({ tab: payload.attempt.tabSwitches, fullscreen: payload.attempt.fullscreenExits, flagged: payload.attempt.flagged });
      setData(payload);
    })();
    return () => { alive = false; cancelSignal.cancelled = true; };
  }, [attemptId, router]);

  const total = data?.questions.length ?? 0;
  const expiresAt = data ? new Date(data.attempt.expiresAt).getTime() : 0;
  const remaining = expiresAt - (now + offset);

  // ---- answer changes: IndexedDB immediately, server sync debounced ----
  const syncTimer = useRef<ReturnType<typeof setTimeout>>();
  const syncToServer = useCallback((beacon = false) => {
    const body = JSON.stringify({ answers: answersRef.current });
    const url = `/api/test/${attemptId}/save`;
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      return;
    }
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
  }, [attemptId]);

  const setAnswer = useCallback((qid: string, value: unknown) => {
    const next = { ...answersRef.current, [qid]: value };
    answersRef.current = next;
    setAnswers(next);
    void saveLocalAnswers(attemptId, next);
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => syncToServer(), 4000);
  }, [attemptId, syncToServer]);

  // ---- submit ----
  const submit = useCallback(async () => {
    if (submittedRef.current || !data) return;
    submittedRef.current = true;
    setSubmitting(true);
    // Python outputs must match the final code: re-run anything edited since its last run.
    for (const qid of Array.from(staleCode.current)) {
      const q = data.questions.find((x) => x.id === qid);
      const a = answersRef.current[qid] as { code?: string } | undefined;
      if (q?.type === 'code_python' && a?.code) {
        const { runPython } = await import('@/lib/runner/client');
        const r = await runPython(a.code, q.calls ?? []);
        answersRef.current = { ...answersRef.current, [qid]: { code: a.code, outputs: r.ok ? r.result.outputs : [] } };
      }
    }
    staleCode.current.clear();
    await saveLocalAnswers(attemptId, answersRef.current);
    const result = await submitWithRetry(attemptId, answersRef.current, () => setRetrying(true), cancel.current);
    if (!result) return;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    router.replace(`/results?attempt=${attemptId}`);
    router.refresh();
  }, [attemptId, data, router]);

  // ---- timer ----
  useEffect(() => {
    if (!data) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [data]);
  useEffect(() => {
    if (data && remaining <= 0 && !submittedRef.current) {
      setWarning(t('test.timeUp'));
      void submit();
    }
  }, [data, remaining, submit, t]);

  // ---- tab switch / fullscreen tracking ----
  const report = useCallback(async (kind: 'tab' | 'fullscreen') => {
    setCounters((c) => {
      const n = kind === 'tab' ? c.tab + 1 : c.fullscreen + 1;
      setWarning(t(kind === 'tab' ? 'test.warnTab' : 'test.warnFullscreen', { n }));
      return kind === 'tab' ? { ...c, tab: n } : { ...c, fullscreen: n };
    });
    try {
      const res = await fetch(`/api/test/${attemptId}/event`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind }), keepalive: true,
      });
      if (res.ok) {
        const r = await res.json();
        if (typeof r.tab_switches === 'number') setCounters({ tab: r.tab_switches, fullscreen: r.fullscreen_exits, flagged: r.flagged });
      }
    } catch { /* counted locally; server count is authoritative */ }
  }, [attemptId, t]);

  useEffect(() => {
    if (!data) return;
    const leave = () => {
      if (submittedRef.current || away.current) return;
      away.current = true;
      void saveLocalAnswers(attemptId, answersRef.current);
      syncToServer(true);
      void report('tab');
    };
    const back = () => { away.current = false; };
    const onVis = () => (document.visibilityState === 'hidden' ? leave() : back());
    const onFs = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      if (!fs && document.fullscreenEnabled && !submittedRef.current) void report('fullscreen');
    };
    const onPageHide = () => { void saveLocalAnswers(attemptId, answersRef.current); syncToServer(true); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', leave);
    window.addEventListener('focus', back);
    document.addEventListener('fullscreenchange', onFs);
    window.addEventListener('pagehide', onPageHide);
    setIsFullscreen(!document.fullscreenEnabled || !!document.fullscreenElement);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', leave);
      window.removeEventListener('focus', back);
      document.removeEventListener('fullscreenchange', onFs);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [data, attemptId, report, syncToServer]);

  const answeredCount = useMemo(
    () => (data?.questions ?? []).filter((q) => {
      const a = answers[q.id] as Record<string, unknown> | undefined;
      if (!a) return false;
      if ('choice' in a) return true;
      if ('code' in a) return String(a.code ?? '').trim().length > 0;
      if ('sql' in a) return String(a.sql ?? '').trim().length > 0;
      return false;
    }).length,
    [answers, data],
  );

  if (loadError) {
    return (
      <main className="mx-auto max-w-md p-6 text-center">
        <p>{t('common.error')}</p>
        <button className="btn-primary mt-4" onClick={() => location.reload()}>{t('common.retry')}</button>
      </main>
    );
  }
  if (!data) return <main className="p-6 text-center text-slate-500">{t('common.loading')}</main>;

  const q = data.questions[idx];
  const low = remaining < 60_000;

  return (
    <div className="flex min-h-screen select-none flex-col bg-white" onContextMenu={(e) => e.preventDefault()}>
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white px-4 py-2">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{skillName}</p>
            <p className="text-xs text-slate-500">{t('test.question', { n: idx + 1, total })}</p>
          </div>
          <div className={`rounded-lg px-3 py-1 font-mono text-lg font-bold ${low ? 'bg-red-100 text-red-700' : 'bg-slate-100'}`}
            aria-label={t('test.timeLeft')} role="timer">
            {fmt(remaining)}
          </div>
        </div>
        <div className="mx-auto mt-2 flex max-w-2xl gap-1">
          {data.questions.map((qq, i) => (
            <button key={qq.id} type="button" onClick={() => setIdx(i)} aria-label={`${i + 1}`}
              className={`h-2 flex-1 rounded-full ${i === idx ? 'bg-brand-600' : answers[qq.id] ? 'bg-brand-200' : 'bg-slate-200'}`} />
          ))}
        </div>
      </header>

      {warning && (
        <div role="alert" className="mx-auto mt-2 w-full max-w-2xl px-4">
          <div className="flex items-start justify-between gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            <span>{warning}</span>
            <button className="font-bold" onClick={() => setWarning(null)} aria-label="dismiss">×</button>
          </div>
        </div>
      )}
      {counters.flagged && (
        <p className="mx-auto mt-2 w-full max-w-2xl px-4 text-sm text-red-700">{t('test.flagged')}</p>
      )}
      {!isFullscreen && !submitting && (
        <div className="mx-auto mt-2 w-full max-w-2xl px-4">
          <button className="btn-secondary w-full" onClick={() => document.documentElement.requestFullscreen().catch(() => undefined)}>
            {t('test.enterFullscreen')}
          </button>
        </div>
      )}

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4">
        <p className="whitespace-pre-wrap text-base leading-relaxed text-slate-900">{q.body}</p>
        {q.options && (
          <div className="mt-4 space-y-2">
            {q.options.map((o) => {
              const selected = (answers[q.id] as { choice?: number } | undefined)?.choice === o.key;
              return (
                <button key={o.key} type="button" onClick={() => setAnswer(q.id, { choice: o.key })}
                  className={`block w-full rounded-xl border p-3 text-left ${selected ? 'border-brand-600 bg-brand-50 font-medium' : 'border-slate-300 bg-white'}`}
                  aria-pressed={selected}>
                  {o.text}
                </button>
              );
            })}
          </div>
        )}
        {(q.type === 'code_python' || q.type === 'sql_query') && (
          <CodeQuestion
            key={q.id}
            question={q}
            value={answers[q.id] as { code?: string; outputs?: (string | null)[]; sql?: string } | undefined}
            onChange={(v, ran) => {
              if (q.type === 'code_python') {
                if (ran) staleCode.current.delete(q.id); else staleCode.current.add(q.id);
              }
              setAnswer(q.id, v);
            }}
          />
        )}
      </main>

      <footer className="sticky bottom-0 border-t border-slate-200 bg-white p-3">
        {retrying && <p className="mx-auto mb-2 max-w-2xl text-center text-sm text-amber-700">{t('test.submitRetry')}</p>}
        <div className="mx-auto flex max-w-2xl gap-2">
          <button className="btn-secondary flex-1" disabled={idx === 0 || submitting} onClick={() => setIdx(idx - 1)}>{t('test.prev')}</button>
          {idx < total - 1 ? (
            <button className="btn-primary flex-1" disabled={submitting} onClick={() => setIdx(idx + 1)}>{t('test.next')}</button>
          ) : (
            <ConfirmSubmit
              label={submitting ? t('test.submitting') : t('test.submit')}
              confirm={t('test.submitConfirm', { answered: answeredCount, total })}
              disabled={submitting}
              onConfirm={submit}
            />
          )}
        </div>
        {idx < total - 1 && (
          <div className="mx-auto mt-2 max-w-2xl text-center">
            <ConfirmSubmit
              label={t('test.submit')}
              confirm={t('test.submitConfirm', { answered: answeredCount, total })}
              disabled={submitting}
              onConfirm={submit}
              subtle
            />
          </div>
        )}
      </footer>
      <span hidden data-skill={skillSlug} />
    </div>
  );
}

/** Two-tap confirm (no window.confirm: blocked in some webviews/TWA). */
function ConfirmSubmit({ label, confirm, disabled, onConfirm, subtle }: {
  label: string; confirm: string; disabled: boolean; onConfirm: () => void; subtle?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <div className="flex flex-1 flex-col gap-2">
        <p className="text-center text-sm text-slate-700">{confirm}</p>
        <div className="flex gap-2">
          <button className="btn-secondary flex-1" onClick={() => setAsking(false)}>×</button>
          <button className="btn-primary flex-1" disabled={disabled} onClick={onConfirm}>{label}</button>
        </div>
      </div>
    );
  }
  return (
    <button className={subtle ? 'text-sm font-medium text-brand-700 underline' : 'btn-primary flex-1'} disabled={disabled} onClick={() => setAsking(true)}>
      {label}
    </button>
  );
}

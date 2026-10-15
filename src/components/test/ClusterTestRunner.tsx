'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n/client';
import { ClusterModePicker } from './ClusterModePicker';

interface Option { key: number; text: string }
interface State {
  attemptId: string; status: 'in_progress' | 'submitted'; expiresAt: string; serverNow: string;
  total: number; answered: number;
  skills: { skill: string; count: number; answered: number; stopped: boolean }[];
  question: { id: string; body: string; skill: string; options?: Option[] } | null;
  results: Record<string, number> | null;
  threshold: number;
  mode: 'self' | 'campus';
  tabSwitches: number;
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Combined skill-group test: one question at a time, graded on the server as you go (a skill stops
 * after 2 wrong answers in a row). Ends with a score per skill.
 */
export function ClusterTestRunner({ cluster, title, hasWorkshop }: { cluster: string; title: string; hasWorkshop: boolean }) {
  const { t, lang } = useT();
  const [tabWarning, setTabWarning] = useState<number | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const skew = useRef(0);

  async function call(url: string, init?: RequestInit) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { cache: 'no-store', ...init });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? String(res.status));
      return body as State;
    } catch (e) {
      const code = (e as Error).message;
      setError(t(code === 'no_questions' ? 'cluster.noQuestions' : code === 'Failed to fetch' ? 'cluster.offline' : 'common.error'));
      return null;
    } finally {
      setBusy(false);
    }
  }
  const apply = (s: State | null) => {
    if (!s) return;
    skew.current = new Date(s.serverNow).getTime() - Date.now();
    setChoice(null);
    setState(s);
  };

  async function begin(mode: 'self' | 'campus', pin?: string) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/cluster-test/start', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cluster, mode, pin }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok || !body?.attemptId) {
      if (body?.error === 'pin_wrong') setError(t('test.pinWrong', { left: body.left ?? 0 }));
      else if (body?.error === 'pin_locked') {
        const time = new Date(body.until).toLocaleTimeString(lang === 'ta' ? 'ta-IN' : 'en-IN', { hour: '2-digit', minute: '2-digit' });
        setError(t('test.pinLocked', { time }));
      } else setError(t(body?.error === 'no_questions' ? 'cluster.noQuestions' : body?.error === 'no_workshop' ? 'test.noWorkshop' : 'common.error'));
      return;
    }
    apply(await call(`/api/cluster-test/${body.attemptId}`));
  }

  // Without a workshop there is nothing to choose: start (or resume) in self mode right away.
  useEffect(() => {
    if (!hasWorkshop) void begin('self');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster, hasWorkshop]);

  // Leaving the test screen is recorded (proctor board; too many switches flag the attempt).
  const attemptId = state?.status === 'in_progress' ? state.attemptId : null;
  useEffect(() => {
    if (!attemptId) return;
    const onVis = () => {
      if (document.visibilityState !== 'hidden') return;
      fetch(`/api/cluster-test/${attemptId}/event`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'tab' }), keepalive: true,
      }).then((r) => r.json()).then((d: { tab_switches?: number }) => { if (d.tab_switches) setTabWarning(d.tab_switches); }).catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [attemptId]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = state ? new Date(state.expiresAt).getTime() - (now + skew.current) : 0;
  useEffect(() => {
    // time up: reloading the state finishes the test on the server
    if (state?.status === 'in_progress' && left <= 0 && !busy) void call(`/api/cluster-test/${state.attemptId}`).then(apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left <= 0, state?.status]);

  async function submit() {
    if (!state?.question || choice === null) return;
    apply(await call(`/api/cluster-test/${state.attemptId}/answer`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question_id: state.question.id, answer: { choice } }),
    }));
  }

  if (!state) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <h1 className="text-xl font-bold">{title}</h1>
        {hasWorkshop ? (
          <ClusterModePicker busy={busy} error={error} onStart={begin} />
        ) : error ? (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
        ) : (
          <p className="text-slate-600">{t('common.loading')}</p>
        )}
        <Link href="/test" className="btn-secondary w-full">{t('hub.backToTests')}</Link>
      </main>
    );
  }

  if (state.status === 'submitted' || !state.question) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <h1 className="text-xl font-bold">{t('cluster.done', { group: title })}</h1>
        <ul className="space-y-2">
          {Object.entries(state.results ?? {}).map(([skill, pct]) => (
            <li key={skill} className="card flex items-center justify-between gap-3">
              <span className="font-medium">{skill}</span>
              {pct >= state.threshold ? (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-sm font-semibold text-green-800">✓ {t('cluster.verified')} · {Math.round(pct)}%</span>
              ) : (
                <span className="text-sm text-amber-700">{t('cluster.keepPractising')}</span>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-500">{t('cluster.privateNote')}</p>
        <Link href="/test" className="btn-primary w-full">{t('hub.backToTests')}</Link>
      </main>
    );
  }

  const q = state.question;
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-2">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 text-sm">
          <span className="truncate font-semibold">{title} · <span className="text-brand-700">{q.skill}</span></span>
          <span className="shrink-0 font-mono" role="timer" aria-label={t('test.timeLeft')}>{fmt(left)}</span>
        </div>
        <div className="mx-auto mt-1 h-1.5 max-w-2xl overflow-hidden rounded-full bg-slate-100" role="progressbar"
          aria-valuemin={0} aria-valuemax={state.total} aria-valuenow={state.answered}>
          <div className="h-full bg-brand-600 transition-all" style={{ width: `${(state.answered / state.total) * 100}%` }} />
        </div>
        <p className="mx-auto mt-1 max-w-2xl text-xs text-slate-500">{t('cluster.progress', { n: state.answered + 1, total: state.total })}</p>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4">
        <p className="whitespace-pre-wrap text-base leading-relaxed text-slate-900">{q.body}</p>
        <div className="mt-4 space-y-2">
          {(q.options ?? []).map((o) => (
            <button key={o.key} type="button" onClick={() => setChoice(o.key)} aria-pressed={choice === o.key}
              className={`block w-full rounded-xl border p-3 text-left ${choice === o.key ? 'border-brand-600 bg-brand-50 font-medium' : 'border-slate-300 bg-white'}`}>
              {o.text}
            </button>
          ))}
        </div>
        {tabWarning !== null && <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{t('test.warnTab', { n: tabWarning })}</p>}
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </main>
      <footer className="sticky bottom-0 border-t border-slate-200 bg-white p-3">
        <div className="mx-auto max-w-2xl">
          <button className="btn-primary w-full" disabled={choice === null || busy} onClick={submit}>
            {busy ? t('test.submitting') : t('test.next')}
          </button>
        </div>
      </footer>
    </div>
  );
}

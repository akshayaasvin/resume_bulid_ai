'use client';
import { useState } from 'react';
import { useT } from '@/i18n/client';
import type { ClientQuestion } from '@/lib/test-engine/questions';
import { CodeQuestion } from './CodeQuestion';

interface Result { passed: number; total: number; verified: boolean }
interface Offer { skill: string; skillId: string; result: Result | null }
type Value = { code?: string; outputs?: (string | null)[]; sql?: string };

/** "Add coding round (optional)" after a Programming / Data group test. Skip is always available. */
export function CodingRoundOffer({ attemptId, offers }: { attemptId: string; offers: Offer[] }) {
  const { t } = useT();
  const [skipped, setSkipped] = useState(false);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [round, setRound] = useState<{ roundId: string; skillId: string; skill: string; questions: ClientQuestion[] } | null>(null);
  const [answers, setAnswers] = useState<Record<string, Value>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!offers.length || skipped) return null;
  const resultOf = (o: Offer) => results[o.skillId] ?? o.result;

  async function post<R>(url: string, body: unknown): Promise<R | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      return data as R;
    } catch (e) {
      setError(t((e as Error).message === 'no_questions' ? 'test.noQuestions' : 'common.error'));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function start(o: Offer) {
    const r = await post<{ roundId: string; questions: ClientQuestion[]; result: Result | null }>(
      '/api/coding-round/start', { cluster_attempt_id: attemptId, skill_id: o.skillId });
    if (!r) return;
    if (r.result) setResults((m) => ({ ...m, [o.skillId]: r.result! }));
    else { setAnswers({}); setRound({ roundId: r.roundId, skillId: o.skillId, skill: o.skill, questions: r.questions }); }
  }

  async function submit() {
    if (!round) return;
    const r = await post<Result>(`/api/coding-round/${round.roundId}/submit`, { answers });
    if (!r) return;
    setResults((m) => ({ ...m, [round.skillId]: r }));
    setRound(null);
  }

  if (round) {
    return (
      <section className="card space-y-4">
        <h2 className="font-semibold">{t('coding.title', { skill: round.skill })}</h2>
        {round.questions.map((q, i) => (
          <div key={q.id} className="space-y-2 border-t border-slate-100 pt-3 first:border-0 first:pt-0">
            <p className="text-sm font-medium text-slate-500">{t('test.question', { n: i + 1, total: round.questions.length })}</p>
            <p className="whitespace-pre-wrap text-slate-900">{q.body}</p>
            <CodeQuestion question={q} value={answers[q.id]} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
          </div>
        ))}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={() => setRound(null)} disabled={busy}>{t('coding.skip')}</button>
          <button type="button" className="btn-primary flex-[2]" onClick={submit} disabled={busy}>{busy ? t('test.submitting') : t('test.submit')}</button>
        </div>
      </section>
    );
  }

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="font-semibold">{t('coding.offer')}</h2>
        <p className="text-sm text-slate-600">{t('coding.offerHint')}</p>
      </div>
      <ul className="space-y-2">
        {offers.map((o) => {
          const r = resultOf(o);
          return (
            <li key={o.skillId} className="flex items-center justify-between gap-3">
              <span className="font-medium">{o.skill}</span>
              {r ? (
                r.verified
                  ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-sm font-semibold text-green-800">✓ {t('coding.verified')} ({r.passed}/{r.total})</span>
                  : <span className="text-sm text-amber-700">{t('cluster.keepPractising')}</span>
              ) : (
                <button type="button" className="btn-primary shrink-0 text-sm" disabled={busy} onClick={() => start(o)}>{t('coding.start')}</button>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {offers.some((o) => !resultOf(o)) && (
        <button type="button" className="btn-ghost w-full" onClick={() => setSkipped(true)}>{t('coding.skip')}</button>
      )}
    </section>
  );
}

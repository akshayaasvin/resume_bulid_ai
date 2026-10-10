'use client';
import { useState } from 'react';
import { useT } from '@/i18n/client';
import type { ClientQuestion } from '@/lib/test-engine/questions';
import { runPython, runSql, type SqlResult } from '@/lib/runner/client';
import { RunnerStatus } from '../RunnerStatus';

type Value = { code?: string; outputs?: (string | null)[]; sql?: string };

export function CodeQuestion({ question, value, onChange }: {
  question: ClientQuestion;
  value: Value | undefined;
  onChange: (v: Value, ran: boolean) => void;
}) {
  const { t } = useT();
  const isPy = question.type === 'code_python';
  const code = (isPy ? value?.code : value?.sql) ?? question.starterCode ?? '';
  const [running, setRunning] = useState(false);
  const [out, setOut] = useState<{ text?: string; error?: string; table?: SqlResult } | null>(null);

  function edit(next: string) {
    onChange(isPy ? { code: next, outputs: value?.outputs ?? [] } : { sql: next }, false);
  }

  async function run() {
    setRunning(true);
    setOut(null);
    if (isPy) {
      const r = await runPython(code, question.calls ?? []);
      if (r.ok) {
        const lines = (question.calls ?? []).map((c, i) => `${c}  →  ${r.result.outputs[i] ?? 'error'}`);
        setOut({ text: [r.result.stdout.trim(), ...lines].filter(Boolean).join('\n'), error: r.result.error ?? undefined });
        onChange({ code, outputs: r.result.outputs }, true);
      } else {
        setOut({ error: r.timeout ? t('test.timeout') : r.error });
        onChange({ code, outputs: [] }, true);
      }
    } else {
      const r = await runSql(question.sqlSeed ?? '', code);
      if (r.ok) setOut({ table: r.result });
      else setOut({ error: r.timeout ? t('test.timeout') : r.error });
    }
    setRunning(false);
  }

  return (
    <div className="mt-4 space-y-3">
      <RunnerStatus kinds={[isPy ? 'python' : 'sql']} />
      {!isPy && question.sqlSeed && (
        <details className="rounded-lg bg-slate-50 p-2 text-xs">
          <summary className="cursor-pointer font-medium">Tables</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{question.sqlSeed}</pre>
        </details>
      )}
      <textarea
        className="block min-h-[220px] w-full select-text rounded-xl border border-slate-300 bg-slate-900 p-3 font-mono text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        value={code}
        onChange={(e) => edit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault();
            const el = e.currentTarget;
            const s = el.selectionStart;
            const next = code.slice(0, s) + '    ' + code.slice(el.selectionEnd);
            edit(next);
            requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 4; });
          }
        }}
        aria-label="code editor"
      />
      <div className="flex gap-2">
        <button type="button" className="btn-secondary flex-1" disabled={running} onClick={run}>
          {running ? t('test.running') : `▶ ${t('test.run')}`}
        </button>
        <button type="button" className="btn-ghost" onClick={() => edit(question.starterCode ?? '')}>{t('test.reset')}</button>
      </div>
      {out && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="mb-1 text-xs font-semibold uppercase text-slate-500">{t('test.output')}</p>
          {out.text && <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-sm">{out.text}</pre>}
          {out.error && <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-sm text-red-700">{out.error}</pre>}
          {out.table && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr>{out.table.columns.map((c) => <th key={c} className="border-b px-2 py-1 text-left">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {out.table.values.map((row, i) => (
                    <tr key={i}>{row.map((v, j) => <td key={j} className="border-b px-2 py-1 font-mono">{v === null ? 'NULL' : String(v)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from 'react';
import type { BoardData } from '@/lib/proctor-board';

const STATUS_LABEL: Record<string, [string, string]> = {
  registered: ['Registered', 'bg-slate-100 text-slate-700'],
  profile_done: ['Profile done', 'bg-blue-100 text-blue-800'],
  testing: ['Testing', 'bg-amber-100 text-amber-800'],
  submitted: ['Submitted', 'bg-green-100 text-green-800'],
};

function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function ProctorBoard({ batchCode, joinUrl, qr, initial }: { batchCode: string; joinUrl: string; qr: string; initial: BoardData }) {
  const [data, setData] = useState(initial);
  const [offset, setOffset] = useState(new Date(initial.serverNow).getTime() - Date.now());
  const [now, setNow] = useState(Date.now());
  const [stale, setStale] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [hidePin, setHidePin] = useState(false);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/proctor/${encodeURIComponent(batchCode)}/status`, { cache: 'no-store' });
        if (res.status === 401) { location.reload(); return; }
        if (!res.ok) throw new Error();
        const d = (await res.json()) as BoardData;
        if (!alive) return;
        setData(d);
        setOffset(new Date(d.serverNow).getTime() - Date.now());
        setStale(false);
      } catch {
        if (alive) setStale(true);
      }
    };
    const id = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(id); };
  }, [batchCode]);

  // Refresh right when the PIN rotates.
  const msLeft = data.pinExpiresAt ? new Date(data.pinExpiresAt).getTime() - (now + offset) : null;
  useEffect(() => {
    if (msLeft !== null && msLeft <= 0) {
      fetch(`/api/proctor/${encodeURIComponent(batchCode)}/status`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null)).then((d) => d && setData(d)).catch(() => undefined);
    }
  }, [msLeft, batchCode]);

  if (showQr) {
    return (
      <button type="button" className="flex min-h-screen w-full flex-col items-center justify-center gap-6 bg-white p-6" onClick={() => setShowQr(false)}>
        <h1 className="text-3xl font-bold sm:text-5xl">Scan to join · {batchCode}</h1>
        <img src={qr} alt={`QR code for ${joinUrl}`} className="aspect-square w-[min(80vh,90vw)]" />
        <p className="font-mono text-xl sm:text-2xl">{joinUrl}</p>
        <p className="text-slate-500">Tap anywhere to close</p>
      </button>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{data.workshop.name} <span className="text-slate-500">· {data.workshop.batchCode}</span></h1>
          <p className="text-sm text-slate-600">{data.workshop.college} · {data.workshop.date}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setHidePin(!hidePin)}>{hidePin ? 'Show PIN' : 'Hide PIN'}</button>
          <button className="btn-primary" onClick={() => setShowQr(true)}>Show join QR</button>
        </div>
      </header>
      {data.workshop.isDemo && (
        <p className="rounded-lg bg-amber-50 p-2 text-sm font-semibold text-amber-800">DEMO workshop: fixed PIN, for demonstrations only.</p>
      )}
      {stale && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">Connection lost. Showing last known data; retrying every 10 s.</p>}

      <section className="card text-center">
        <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">Current PIN</p>
        <p className="font-mono text-7xl font-bold tracking-[0.2em] text-brand-700 sm:text-9xl" aria-live="polite">
          {hidePin ? '••••••' : data.pin}
        </p>
        {msLeft !== null && <p className="mt-2 text-lg text-slate-600">Changes in {countdown(msLeft)}</p>}
      </section>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Registered', data.counts.registered],
          ['Testing', data.counts.testing],
          ['Submitted', data.counts.submitted],
          ['Flagged', data.counts.flagged],
        ].map(([label, n]) => (
          <div key={label} className="card text-center">
            <p className="text-3xl font-bold">{n}</p>
            <p className="text-sm text-slate-600">{label}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card overflow-x-auto p-0 lg:col-span-2">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr><th className="px-3 py-2">Student</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Test</th><th className="px-3 py-2">Progress</th><th className="px-3 py-2">Tab switches</th></tr>
            </thead>
            <tbody>
              {data.students.map((s) => {
                const [label, cls] = STATUS_LABEL[s.status];
                return (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <div className="font-medium">{s.name}</div>
                      {s.department && <div className="text-xs text-slate-500">{s.department}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`chip ${cls}`}>{label}</span>
                      {s.flagged && <span className="chip ml-1 bg-red-100 text-red-800">Flagged</span>}
                      {s.locked && <span className="chip ml-1 bg-red-100 text-red-800">PIN locked</span>}
                    </td>
                    <td className="px-3 py-2">
                      {s.skill ?? '–'}
                      {s.kind === 'group' && <span className="chip ml-1 bg-brand-100 text-brand-700">Group</span>}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{s.progress ? `${s.progress.answered}/${s.progress.total}` : '–'}</td>
                    <td className={`px-3 py-2 ${s.tabSwitches > 2 ? 'font-bold text-red-700' : ''}`}>{s.tabSwitches}</td>
                  </tr>
                );
              })}
              {data.students.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">No students yet. Show the join QR.</td></tr>
              )}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h2 className="mb-2 font-semibold">Wrong PIN / lock log</h2>
          <ul className="max-h-96 space-y-1 overflow-y-auto text-sm">
            {data.pinLog.map((p, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span>{p.name}{p.locked && <span className="ml-1 font-semibold text-red-700">LOCKED</span>}</span>
                <span className="text-slate-500">{new Date(p.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
              </li>
            ))}
            {data.pinLog.length === 0 && <li className="text-slate-500">No wrong PINs.</li>}
          </ul>
        </section>
      </div>
    </main>
  );
}

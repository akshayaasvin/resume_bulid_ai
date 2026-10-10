'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ProctorLogin({ batchCode }: { batchCode: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="mx-auto max-w-sm px-4 py-12">
      <h1 className="text-2xl font-bold">Proctor login</h1>
      <p className="mt-1 text-slate-600">Workshop {batchCode}</p>
      <form
        className="mt-6 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const res = await fetch('/api/proctor/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ batch_code: batchCode, password }),
          }).catch(() => null);
          setBusy(false);
          if (res?.ok) router.refresh();
          else setError('Wrong password or inactive workshop.');
        }}
      >
        <div>
          <label className="label" htmlFor="pw">Proctor password</label>
          <input id="pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </div>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Checking…' : 'Open board'}</button>
      </form>
    </main>
  );
}

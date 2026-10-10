#!/usr/bin/env node
// Workshop load test: N registrations spread over a window, then N concurrent test submits.
//   BASE_URL=http://localhost:3000 N=200 WINDOW_S=120 node scripts/load-test.mjs
// Uses the demo workshop (DEMO-001, PIN 1234). Creates real accounts: run against a test project.
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const N = Number(process.env.N ?? 200);
const WINDOW_MS = Number(process.env.WINDOW_S ?? 120) * 1000;
const BATCH = process.env.BATCH ?? 'DEMO-001';
const PIN = process.env.PIN ?? '1234';
const run = Date.now().toString().slice(-5);

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}
function summary(name, samples) {
  const ok = samples.filter((s) => s.ok).map((s) => s.ms);
  const fails = samples.filter((s) => !s.ok);
  const codes = {};
  for (const f of fails) codes[f.status] = (codes[f.status] ?? 0) + 1;
  return {
    step: name, total: samples.length, ok: ok.length, failed: fails.length, failCodes: codes,
    p50_ms: pct(ok, 50), p95_ms: pct(ok, 95), p99_ms: pct(ok, 99), max_ms: Math.max(0, ...ok),
  };
}

class Client {
  cookies = new Map();
  async req(method, path, body) {
    const t = performance.now();
    let status = 0;
    let json = null;
    try {
      const res = await fetch(BASE + path, {
        method,
        headers: {
          'content-type': 'application/json',
          cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
      });
      status = res.status;
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [kv] = c.split(';');
        const i = kv.indexOf('=');
        const k = kv.slice(0, i);
        const v = kv.slice(i + 1);
        if (v === '' || /max-age=0/i.test(c)) this.cookies.delete(k); else this.cookies.set(k, v);
      }
      json = await res.json().catch(() => null);
    } catch {
      status = -1;
    }
    return { ok: status >= 200 && status < 300, status, ms: performance.now() - t, json };
  }
}

const users = Array.from({ length: N }, (_, i) => ({ i, client: new Client(), phone: `8${run}${String(i).padStart(4, '0')}` }));

console.log(`Phase A: ${N} registrations over ${WINDOW_MS / 1000}s against ${BASE}`);
const reg = await Promise.all(users.map(async (u) => {
  await new Promise((r) => setTimeout(r, (u.i / N) * WINDOW_MS));
  const r = await u.client.req('POST', '/api/auth/register', {
    full_name: `Load User ${u.i}`, phone: `+91${u.phone}`, password: 'secret12', batch_code: BATCH, whatsapp_opt_in: false, language: 'en',
  });
  u.registered = r.ok && r.json?.next === '/wizard';
  return r;
}));

console.log('Phase B: starting campus attempts');
const startSamples = [];
const queue = users.filter((u) => u.registered);
await Promise.all(Array.from({ length: 25 }, async () => {
  while (queue.length) {
    const u = queue.shift();
    const r = await u.client.req('POST', '/api/test/start', { skill: 'excel', mode: 'campus', pin: PIN });
    startSamples.push(r);
    if (!r.ok) continue;
    u.attemptId = r.json.attemptId;
    const a = await u.client.req('GET', `/api/test/${u.attemptId}`);
    if (a.ok) {
      u.answers = Object.fromEntries(a.json.questions.map((q) => [q.id, { choice: q.options?.[0]?.key ?? 0 }]));
    }
  }
}));

const ready = users.filter((u) => u.answers);
console.log(`Phase C: ${ready.length} concurrent submits`);
const t0 = performance.now();
const submits = await Promise.all(ready.map((u) => u.client.req('POST', `/api/test/${u.attemptId}/submit`, { answers: u.answers })));
const wall = performance.now() - t0;

const report = {
  base: BASE,
  results: [summary('register', reg), summary('test_start', startSamples), summary('submit (concurrent)', submits)],
  submitWallClockMs: Math.round(wall),
};
console.table(report.results);
console.log(JSON.stringify(report, null, 2));

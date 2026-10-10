# Resume Build AI — verified-skill resumes

Students register (usually at an on-campus workshop), build a profile, get a resume, take a
supervised skill test, and get a **verified-skill resume**.
Core rule: **claimed skill ≠ verified skill**. Only server-graded test scores count.

Stack: Next.js 14 (App Router) · TypeScript · Tailwind · Supabase (Postgres, Auth, Storage, RLS) · Vercel.

| Phase | Status |
|---|---|
| 1 — Core candidate flow (workshop-ready) | ✅ v0.1.0 |
| 2 — AI features | planned |
| 3 — Jobs & internships | planned |
| 4 — Follow-ups, dashboards | planned |
| 5 — PWA polish & release | planned |

---

## Local setup

Requirements: Node 20+, a Supabase project (free tier is fine).

```bash
npm install
cp .env.example .env.local      # fill in the values (see below)
npm run db:migrate              # applies supabase/migrations/*.sql in order (tracked in schema_migrations)
npm run db:seed                 # 5 skills, 150 questions, demo workshop DEMO-001 — safe to re-run
npm run dev                     # http://localhost:3000
```

### Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | anon key (RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | account creation, grading, PIN checks |
| `SUPABASE_DB_URL` | scripts only | direct Postgres URL for `db:migrate` / `db:seed` |
| `APP_SECRET` | **server only** | ≥32 random chars; signs proctor sessions |
| `ANTHROPIC_API_KEY` | **server only** | Phase 2 |
| `ANTHROPIC_MODEL` | server | Phase 2 (default `claude-haiku-4-5-20251001`) |
| `NEXT_PUBLIC_PYODIDE_BASE_URL` | browser | Pyodide CDN base (ends with `/`) |
| `NEXT_PUBLIC_SQLJS_BASE_URL` | browser | sql.js CDN base (ends with `/`) |
| `NEXT_PUBLIC_APP_URL` | server | public URL used in the join QR code |

Never commit `.env.local`. A pre-commit hook (`scripts/secret-scan.sh`) blocks staged keys.
To install the hook on a fresh clone: `printf '#!/usr/bin/env bash\nbash scripts/secret-scan.sh\n' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit`.

### Supabase settings to change
- **Authentication → Rate limits**: raise *sign-ins/sign-ups* and *token refreshes* (e.g. 1,000 per 5 min).
  All logins go through our server, so Supabase sees few IPs (Vercel's), not one per phone.
- Accounts are created with the admin API, already confirmed — no email/SMS provider needed.

## How it works (Phase 1)

- **Accounts**: phone (+91) + password. Supabase Auth needs an email, so the server derives a
  non-routable one (`p91XXXXXXXXXX@users.resumebuild.invalid`). The real contact email is optional.
  Sign-up creates the user via the admin API and issues the session server-side (cookies).
- **Profile wizard** (`/wizard`): Education → Experience/Projects → Claimed skills. Autosaves
  (debounced) with a localStorage draft that re-syncs when the network returns.
- **Resume**: versioned snapshots in `resumes`; v1 after the wizard, a new verified version whenever a
  best score ≥50% changes. HTML preview + PDF (`@react-pdf/renderer`, Noto Sans + Noto Sans Tamil,
  bundled in `public/fonts`, OFL). PDFs are cached in the private `resumes` bucket.
- **Tests** (`/test/[skill]`): 15 questions (5 easy / 7 medium / 3 hard, ≤2 coding), 20 minutes,
  options shuffled per attempt, answers never sent to the browser.
  - Campus mode needs the workshop **PIN** (6 digits, HMAC of `pin_secret` + 30-minute window; the
    previous PIN is accepted for 2 minutes after rotation). 5 wrong tries per account *or* device →
    10-minute lock, logged in `pin_attempts`.
  - Answers go to IndexedDB on every change, sync to the server opportunistically and on
    `pagehide`/`visibilitychange` (beacon). Submit retries with exponential backoff until it lands.
  - Tab switches / fullscreen exits are counted server-side; 3 of either auto-flags the attempt.
  - Python runs in Pyodide and SQL in sql.js, each in a Web Worker killed after 8 s; `input()` is
    blocked. SQL is **re-executed on the server** for grading; Python outputs are produced in the
    browser and compared to hidden expected outputs on the server (±0.01 numeric tolerance).
- **Scoring** (editable in `config`): 80+ Advanced · 65–79 Intermediate · 50–64 Beginner · <50 Needs
  Improvement. Below 50% never appears on a resume or any public view — it goes to the skill-gap list.
  Badge `campus_verified` = campus mode + valid PIN + ≤2 tab switches + submitted within grace;
  `verified` = campus attempt that missed one of those; `self` = self mode or flagged. Best score per skill wins.
- **Proctor board** (`/proctor/[batch_code]`): workshop password → signed cookie. Big PIN with countdown,
  live status every 10 s (never shows scores), wrong-PIN/lock log, full-screen join QR.

## Tests

```bash
npm test            # unit tests (scoring, badges, grading, PIN, question mix, no-secrets, seed answers, PDF)
npm run test:rls    # RLS suite: needs RLS_DB_URL=postgres://postgres:postgres@localhost:5432/postgres (throwaway)
npm run test:e2e    # Playwright, Pixel 5 viewport; needs a running app + E2E_DB_URL
npm run load-test   # BASE_URL=... N=200 WINDOW_S=120 — creates real accounts; use a test project
```

CI (GitHub Actions) runs lint, typecheck, unit tests and build, plus the RLS suite against a
Postgres 17 service container (with `tests/rls/supabase-shim.sql` standing in for Supabase's auth/storage).

### Local stand-in stack (no Supabase project needed)
`scripts/local-stack/` runs real Postgres + PostgREST behind a small gateway that mimics Supabase Auth
(admin create user, password/refresh grants) and Storage. Used for e2e and load tests:

```bash
LOCAL_PG_URL=postgres://postgres:postgres@localhost:54329/postgres POSTGREST_BIN=postgrest npm run local-stack
# then build/start the app with the env printed to .local-stack/env.json
```

## Deploy (Vercel)
1. Import the GitHub repo in Vercel (framework: Next.js).
2. Add the env vars above (Production + Preview). Do **not** add `SUPABASE_DB_URL` unless needed.
3. Run `npm run db:migrate && npm run db:seed` from your machine against the production DB.
4. Create a real workshop (Phase 4 adds an admin UI; until then insert into `workshops` and set
   `proctor_password_hash` with bcrypt).

## Workshop-day checklist (draft — completed in Phase 5)
- Supabase project not paused (free tier pauses after inactivity) — open the dashboard the day before.
- Proctor board opens and the PIN rotates (`/proctor/<BATCH>`).
- Open one Python test on a student phone first so the runtime is cached ("Code runner ready ✓").
- Hall WiFi down? Students keep answering — answers stay on the phone and submit when back online.

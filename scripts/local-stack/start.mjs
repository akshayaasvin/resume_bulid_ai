#!/usr/bin/env node
// Starts the local Supabase stand-in: fresh database (shim + migrations + seed), PostgREST, gateway.
// Usage:
//   LOCAL_PG_URL=postgres://postgres:postgres@localhost:54329/postgres \
//   POSTGREST_BIN=/path/to/postgrest node scripts/local-stack/start.mjs
// Prints the env vars to run the app against it.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate, seed } from '../db.mjs';
import { apiKeys } from './jwt.mjs';
import { startGateway } from './gateway.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ADMIN_URL = process.env.LOCAL_PG_URL ?? 'postgres://postgres:postgres@localhost:54329/postgres';
const DB = process.env.LOCAL_DB_NAME ?? 'localstack';
const JWT_SECRET = process.env.LOCAL_JWT_SECRET ?? 'local-stack-jwt-secret-must-be-at-least-32-chars';
const GATEWAY_PORT = Number(process.env.LOCAL_GATEWAY_PORT ?? 54321);
const PGRST_PORT = Number(process.env.LOCAL_POSTGREST_PORT ?? 54322);
const workDir = process.env.LOCAL_STACK_DIR ?? path.join(root, '.local-stack');
mkdirSync(workDir, { recursive: true });

const dbUrl = (() => { const u = new URL(ADMIN_URL); u.pathname = `/${DB}`; return u.toString(); })();

// 1. fresh database
const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
await admin.query(`drop database if exists ${DB} with (force)`);
await admin.query(`create database ${DB} encoding 'UTF8' template template0 lc_collate 'C' lc_ctype 'C'`);
await admin.end();

const db = new pg.Client({ connectionString: dbUrl });
await db.connect();
await db.query(readFileSync(path.join(root, 'tests', 'rls', 'supabase-shim.sql'), 'utf8'));
await db.query(`alter table auth.users add column if not exists encrypted_password text`);
await db.query(`do $$ begin create role authenticator login password 'authenticator' noinherit; exception when duplicate_object then null; end $$`);
await db.query(`grant anon, authenticated, service_role to authenticator`);
await migrate(db);
await seed(db);
await db.end();

// 2. PostgREST
const confPath = path.join(workDir, 'postgrest.conf');
const authUrl = (() => { const u = new URL(dbUrl); u.username = 'authenticator'; u.password = 'authenticator'; return u.toString(); })();
writeFileSync(confPath, [
  `db-uri = "${authUrl}"`,
  'db-schemas = "public"',
  'db-anon-role = "anon"',
  `jwt-secret = "${JWT_SECRET}"`,
  `server-port = ${PGRST_PORT}`,
  'db-pool = 30',
  'db-pool-acquisition-timeout = 20',
  'log-level = "warn"',
].join('\n'));
const bin = process.env.POSTGREST_BIN ?? 'postgrest';
// LOCAL_SPAWN_POSTGREST=0: start PostgREST yourself (`postgrest .local-stack/postgrest.conf`),
// e.g. where child processes can't own a console.
let pgrst = null;
if (process.env.LOCAL_SPAWN_POSTGREST !== '0') {
  pgrst = spawn(bin, [confPath], { stdio: ['pipe', 'inherit', 'inherit'] });
  pgrst.on('exit', (code) => { console.error(`postgrest exited (${code})`); process.exit(1); });
} else {
  console.log(`waiting for PostgREST: start it with  postgrest ${confPath}`);
}

// No HTTP readiness poll: PostgREST 12 on Windows can crash if it receives a request while it is
// still loading its schema cache. Requests through the gateway simply fail until it is up.
if (pgrst) await new Promise((r) => setTimeout(r, 5000));

// 3. gateway
await startGateway({
  port: GATEWAY_PORT, postgrestUrl: `http://localhost:${PGRST_PORT}`, dbUrl, jwtSecret: JWT_SECRET,
  storageDir: path.join(workDir, 'storage'),
});

const keys = apiKeys(JWT_SECRET);
const env = {
  NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${GATEWAY_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: keys.anon,
  SUPABASE_SERVICE_ROLE_KEY: keys.service,
  SUPABASE_DB_URL: dbUrl,
  APP_SECRET: 'local-stack-app-secret-not-for-production-0000',
};
writeFileSync(path.join(workDir, 'env.json'), JSON.stringify(env, null, 2));
console.log(`LOCAL STACK READY on http://localhost:${GATEWAY_PORT} (env written to ${path.join(workDir, 'env.json')})`);

const stop = () => { pgrst?.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

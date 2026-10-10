#!/usr/bin/env node
// Database tooling: `node scripts/db.mjs migrate | seed`
// Uses SUPABASE_DB_URL (direct Postgres connection) from .env.local. Both commands are re-runnable.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import pg from 'pg';
import { loadSeed, validateSeed } from './seed-data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local') });

const CONFIG_DEFAULTS = {
  scoring: { advancedMin: 80, intermediateMin: 65, beginnerMin: 50, maxTabSwitchesForCampusBadge: 2, autoFlagAfter: 3 },
  test: {
    durationMinutes: 20, mix: { easy: 5, medium: 7, hard: 3 }, maxCodingQuestions: 2, selfModeGraceMinutes: 2,
    lateHardLimitMinutes: 60, pinMaxWrong: 5, pinLockMinutes: 10, pinRotateMinutes: 30,
  },
  limits: { aiDailyCallsPerUser: 10 },
};

export async function connect(url = process.env.SUPABASE_DB_URL) {
  if (!url) throw new Error('SUPABASE_DB_URL is not set (see .env.example)');
  const client = new pg.Client({
    connectionString: url,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

export async function migrate(client) {
  await client.query(`create table if not exists public.schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  const dir = path.join(root, 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await client.query('select name from public.schema_migrations');
  const done = new Set(rows.map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) continue;
    process.stdout.write(`applying ${f} ... `);
    await client.query('begin');
    try {
      await client.query(readFileSync(path.join(dir, f), 'utf8'));
      await client.query('insert into public.schema_migrations(name) values ($1)', [f]);
      await client.query('commit');
      console.log('ok');
    } catch (e) {
      await client.query('rollback');
      console.log('FAILED');
      throw e;
    }
  }
  console.log('migrations up to date');
}

export async function seed(client) {
  const data = loadSeed();
  const problems = validateSeed(data);
  if (problems.length) throw new Error(`seed validation failed:\n${problems.join('\n')}`);

  await client.query('begin');
  try {
    for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
      // do nothing on conflict: keep super_admin edits
      await client.query('insert into config(key, value) values ($1, $2) on conflict (key) do nothing', [key, value]);
    }

    let qCount = 0;
    for (const s of data.skills) {
      const { rows: [skill] } = await client.query(
        `insert into skills(slug, name, category, assessment_type, is_active) values ($1,$2,$3,$4,true)
         on conflict (slug) do update set name = excluded.name, category = excluded.category, assessment_type = excluded.assessment_type
         returning id`,
        [s.slug, s.name, s.category, s.assessment_type],
      );
      for (const q of s.questions) {
        await client.query(
          `insert into questions(external_key, skill_id, type, difficulty, body, options, correct, test_cases, sql_seed,
                                 starter_code, explanation, marks, status, source)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'published','manual')
           on conflict (external_key) do update set
             skill_id = excluded.skill_id, type = excluded.type, difficulty = excluded.difficulty, body = excluded.body,
             options = excluded.options, correct = excluded.correct, test_cases = excluded.test_cases,
             sql_seed = excluded.sql_seed, starter_code = excluded.starter_code, explanation = excluded.explanation,
             marks = excluded.marks`,
          [
            q.key, skill.id, q.type, q.difficulty, q.body,
            q.options ? JSON.stringify(q.options) : null,
            q.correct ?? null,
            q.test_cases ? JSON.stringify(q.test_cases) : null,
            q.sql_seed, q.starter_code ?? null, q.explanation ?? null, q.marks,
          ],
        );
        qCount++;
      }
    }

    const { college, workshop } = data.demo;
    const { rows: [c] } = await client.query(
      `insert into colleges(name, city) values ($1,$2) on conflict (name) do update set city = excluded.city returning id`,
      [college.name, college.city],
    );
    const hash = await bcrypt.hash(workshop.proctor_password, 10);
    await client.query(
      `insert into workshops(college_id, batch_code, name, date, is_active, is_demo, demo_pin, proctor_password_hash, late_grace_minutes)
       values ($1,$2,$3,current_date,true,true,$4,$5,$6)
       on conflict (batch_code) do update set
         college_id = excluded.college_id, name = excluded.name, is_active = true, is_demo = true,
         demo_pin = excluded.demo_pin, proctor_password_hash = excluded.proctor_password_hash,
         late_grace_minutes = excluded.late_grace_minutes`,
      [c.id, workshop.batch_code, workshop.name, workshop.demo_pin, hash, workshop.late_grace_minutes],
    );
    await client.query('commit');
    console.log(`seeded ${data.skills.length} skills, ${qCount} questions, demo workshop ${workshop.batch_code}`);
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cmd = process.argv[2];
  const client = await connect();
  try {
    if (cmd === 'migrate') await migrate(client);
    else if (cmd === 'seed') await seed(client);
    else {
      console.error('usage: node scripts/db.mjs migrate|seed');
      process.exitCode = 1;
    }
  } catch (e) {
    console.error(e.message ?? e);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

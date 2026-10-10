/**
 * Row-level security checks against real Postgres running our real migrations.
 * Each "user" runs as the `authenticated` role with JWT claims set exactly the way
 * Supabase's PostgREST does it, so policies evaluate as they would in production.
 *
 * Run: RLS_DB_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:rls
 * (creates and drops a throwaway database; never point it at production)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
// @ts-expect-error - plain ESM helper
import { migrate, seed } from '../../scripts/db.mjs';

const ADMIN_URL = process.env.RLS_DB_URL;
const suite = ADMIN_URL ? describe : describe.skip;

const DB_NAME = `rls_test_${Date.now()}`;
let admin: pg.Client;
let db: pg.Client;

const ids = {
  collegeA: '', collegeB: '', workshopA: '', workshopB: '',
  candA: '11111111-1111-1111-1111-111111111111',
  candB: '22222222-2222-2222-2222-222222222222',
  candOtherCollege: '33333333-3333-3333-3333-333333333333',
  tpoA: '44444444-4444-4444-4444-444444444444',
  superAdmin: '55555555-5555-5555-5555-555555555555',
  employer: '66666666-6666-6666-6666-666666666666',
  skill: '', question: '', attemptA: '', attemptB: '',
};

/** Run `sql` as a signed-in user (or anon when uid is null), inside a rolled-back transaction. */
async function as<T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []) {
  await db.query('begin');
  try {
    const role = uid ? 'authenticated' : 'anon';
    await db.query(`set local role ${role}`);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'anon' }),
    ]);
    const res = await db.query(sql, params);
    return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
  } finally {
    await db.query('rollback');
  }
}

async function expectDenied(uid: string | null, sql: string, params: unknown[] = []) {
  await expect(as(uid, sql, params)).rejects.toThrow(/permission denied|row-level security|not allowed|violates/);
}

suite('RLS', () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${DB_NAME} encoding 'UTF8' template template0 lc_collate 'C' lc_ctype 'C'`);
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${DB_NAME}`;
    db = new pg.Client({ connectionString: url.toString() });
    await db.connect();
    await db.query(readFileSync(path.join(__dirname, 'supabase-shim.sql'), 'utf8'));
    const quiet = console.log;
    console.log = () => undefined;
    try {
      await migrate(db);
      await seed(db);
    } finally {
      console.log = quiet;
    }

    // Fixtures (as the table owner, like the service role would).
    const q = (sql: string, p: unknown[] = []) => db.query(sql, p);
    ids.collegeA = (await q(`insert into colleges(name) values ('College A') returning id`)).rows[0].id;
    ids.collegeB = (await q(`insert into colleges(name) values ('College B') returning id`)).rows[0].id;
    ids.workshopA = (await q(`insert into workshops(college_id, batch_code, name, date) values ($1,'WS-A','A',current_date) returning id`, [ids.collegeA])).rows[0].id;
    ids.workshopB = (await q(`insert into workshops(college_id, batch_code, name, date) values ($1,'WS-B','B',current_date) returning id`, [ids.collegeB])).rows[0].id;

    const users: [string, string, string | null, string | null, string][] = [
      [ids.candA, 'candidate', ids.collegeA, ids.workshopA, '+919000000001'],
      [ids.candB, 'candidate', ids.collegeA, ids.workshopA, '+919000000002'],
      [ids.candOtherCollege, 'candidate', ids.collegeB, ids.workshopB, '+919000000003'],
      [ids.tpoA, 'college_admin', ids.collegeA, null, '+919000000004'],
      [ids.superAdmin, 'super_admin', null, null, '+919000000005'],
      [ids.employer, 'employer', null, null, '+919000000006'],
    ];
    for (const [id, role, college, ws, phone] of users) {
      await q(`insert into auth.users(id, email) values ($1, $2)`, [id, `${id}@t.invalid`]);
      await q(
        `insert into profiles(id, role, full_name, college_id, workshop_id, phone_whatsapp) values ($1,$2,$3,$4,$5,$6)`,
        [id, role, `User ${role}`, college, ws, phone],
      );
    }
    ids.skill = (await q(`select id from skills where slug = 'python'`)).rows[0].id;
    ids.question = (await q(`select id from questions where skill_id = $1 limit 1`, [ids.skill])).rows[0].id;
    for (const who of [ids.candA, ids.candB, ids.candOtherCollege]) {
      await q(`insert into education(profile_id, institution, degree) values ($1, 'X', 'B.E.')`, [who]);
      await q(`insert into skill_scores(profile_id, skill_id, score_pct, level, badge) values ($1,$2,72,'intermediate','self')`, [who, ids.skill]);
    }
    ids.attemptA = (await q(
      `insert into attempts(profile_id, skill_id, question_ids, expires_at, status) values ($1,$2,array[$3::uuid], now() + interval '20 min', 'in_progress') returning id`,
      [ids.candA, ids.skill, ids.question],
    )).rows[0].id;
    await q(`insert into attempt_answers(attempt_id, question_id, answer) values ($1,$2,'{"choice":1}')`, [ids.attemptA, ids.question]);
    await q(`insert into storage.objects(bucket_id, name) values ('resumes', $1), ('resumes', $2)`, [`${ids.candA}/v1.pdf`, `${ids.candB}/v1.pdf`]);
  }, 120_000);

  afterAll(async () => {
    await db?.end();
    if (admin) {
      await admin.query(`drop database if exists ${DB_NAME} with (force)`);
      await admin.end();
    }
  });

  describe('own rows only', () => {
    it('candidate sees only their own profile', async () => {
      const { rows } = await as<{ id: string }>(ids.candA, 'select id from profiles');
      expect(rows.map((r) => r.id)).toEqual([ids.candA]);
    });
    it('candidate sees only their own education, scores, attempts', async () => {
      for (const t of ['education', 'skill_scores', 'attempts']) {
        const { rows } = await as<{ profile_id: string }>(ids.candA, `select profile_id from ${t}`);
        expect(rows.length).toBeGreaterThan(0);
        expect(new Set(rows.map((r) => r.profile_id))).toEqual(new Set([ids.candA]));
      }
    });
    it('candidate cannot insert wizard rows for someone else', async () => {
      await expectDenied(ids.candA, `insert into education(profile_id, institution, degree) values ($1,'Y','Z')`, [ids.candB]);
      await expectDenied(ids.candA, `insert into claimed_skills(profile_id, name) values ($1,'Hacking')`, [ids.candB]);
    });
    it('candidate can manage their own wizard rows', async () => {
      const r = await as(ids.candA, `insert into claimed_skills(profile_id, name) values ($1,'Python') returning id`, [ids.candA]);
      expect(r.rowCount).toBe(1);
    });
    it("candidate cannot update or delete another user's rows", async () => {
      expect((await as(ids.candA, `update education set degree = 'hacked' where profile_id = $1`, [ids.candB])).rowCount).toBe(0);
      expect((await as(ids.candA, `delete from education where profile_id = $1`, [ids.candB])).rowCount).toBe(0);
    });
    it('candidate cannot see another candidate\'s resume PDF', async () => {
      const { rows } = await as<{ name: string }>(ids.candA, `select name from storage.objects where bucket_id = 'resumes'`);
      expect(rows.map((r) => r.name)).toEqual([`${ids.candA}/v1.pdf`]);
    });
  });

  describe('no self-escalation', () => {
    it('candidate can edit their own name', async () => {
      expect((await as(ids.candA, `update profiles set full_name = 'New Name' where id = $1`, [ids.candA])).rowCount).toBe(1);
    });
    it.each([
      ['role', `'super_admin'`],
      ['college_id', 'null'],
      ['workshop_id', 'null'],
      ['employer_approved', 'true'],
      ['phone_whatsapp', `'+919999999999'`],
    ])('candidate cannot change %s', async (col, val) => {
      await expectDenied(ids.candA, `update profiles set ${col} = ${val} where id = $1`, [ids.candA]);
    });
    it('TPO cannot move themselves to another college or change role', async () => {
      await expectDenied(ids.tpoA, `update profiles set college_id = $1 where id = $2`, [ids.collegeB, ids.tpoA]);
      await expectDenied(ids.tpoA, `update profiles set role = 'super_admin' where id = $1`, [ids.tpoA]);
    });
    it('nobody can create profiles or scores from the browser', async () => {
      await expectDenied(ids.candA, `insert into profiles(id, full_name) values (gen_random_uuid(), 'x')`);
      await expectDenied(ids.candA, `insert into skill_scores(profile_id, skill_id, score_pct, level, badge) values ($1,$2,100,'advanced','campus_verified')`, [ids.candA, ids.skill]);
      expect((await as(ids.candA, `update skill_scores set score_pct = 100 where profile_id = $1`, [ids.candA])).rowCount).toBe(0);
      expect((await as(ids.candA, `update attempts set score_pct = 100, badge = 'campus_verified' where profile_id = $1`, [ids.candA])).rowCount).toBe(0);
    });
    it('opt-in timestamp is set by the database, not the client', async () => {
      const { rows } = await as<{ opt_in_at: string | null }>(ids.candA,
        `update profiles set whatsapp_opt_in = true, opt_in_at = '2000-01-01' where id = $1 returning opt_in_at`, [ids.candA]);
      expect(new Date(rows[0].opt_in_at!).getFullYear()).toBeGreaterThan(2020);
    });
  });

  describe('hidden secrets', () => {
    it('workshop PIN secret, demo PIN and proctor password hash are not selectable', async () => {
      for (const col of ['pin_secret', 'proctor_password_hash', 'demo_pin']) {
        await expectDenied(ids.candA, `select ${col} from workshops`);
        await expectDenied(ids.superAdmin, `select ${col} from workshops`);
      }
    });
    it('candidate can read safe columns of their own workshop only', async () => {
      const { rows } = await as<{ batch_code: string }>(ids.candA, 'select batch_code, name from workshops');
      expect(rows.map((r) => r.batch_code)).toEqual(['WS-A']);
    });
    it('candidates and anon cannot read questions (they contain answers)', async () => {
      expect((await as(ids.candA, 'select correct from questions')).rowCount).toBe(0);
      await expectDenied(null, 'select correct from questions');
    });
    it('attempt answers are hidden until the attempt is submitted', async () => {
      expect((await as(ids.candA, 'select * from attempt_answers')).rowCount).toBe(0);
    });
    it('PIN attempt log, AI usage and funnel are super-admin only', async () => {
      for (const t of ['pin_attempts', 'ai_usage', 'funnel_events']) {
        expect((await as(ids.candA, `select * from ${t}`)).rowCount).toBe(0);
        expect((await as(ids.tpoA, `select * from ${t}`)).rowCount).toBe(0);
      }
    });
    it('server-only functions cannot be called by users', async () => {
      await expectDenied(ids.candA, `select * from bump_attempt_counter($1, 'tab', 3)`, [ids.attemptA]);
    });
  });

  describe('TPO (college_admin) is read-only, own college', () => {
    it('sees candidates of their own college only', async () => {
      const { rows } = await as<{ id: string }>(ids.tpoA, `select id from profiles where role = 'candidate'`);
      expect(new Set(rows.map((r) => r.id))).toEqual(new Set([ids.candA, ids.candB]));
    });
    it('sees scores and attempts of their college only', async () => {
      const { rows } = await as<{ profile_id: string }>(ids.tpoA, 'select profile_id from skill_scores');
      expect(rows.map((r) => r.profile_id).sort()).toEqual([ids.candA, ids.candB].sort());
    });
    it('cannot modify candidate data', async () => {
      expect((await as(ids.tpoA, `update profiles set full_name = 'x' where id = $1`, [ids.candA])).rowCount).toBe(0);
      expect((await as(ids.tpoA, `update education set degree = 'x' where profile_id = $1`, [ids.candA])).rowCount).toBe(0);
      expect((await as(ids.tpoA, `delete from education where profile_id = $1`, [ids.candA])).rowCount).toBe(0);
      await expectDenied(ids.tpoA, `insert into skill_scores(profile_id, skill_id, score_pct, level, badge) values ($1,$2,99,'advanced','self')`, [ids.candA, ids.skill]);
    });
    it("cannot see the other college's workshop", async () => {
      const { rows } = await as<{ batch_code: string }>(ids.tpoA, 'select batch_code from workshops');
      expect(rows.map((r) => r.batch_code)).toEqual(['WS-A']);
    });
  });

  describe('public catalogue and admin', () => {
    it('anon can read active skills and config, not profiles', async () => {
      expect((await as(null, 'select slug from skills')).rowCount).toBe(5);
      expect((await as(null, 'select key from config')).rowCount).toBe(3);
      expect((await as(null, 'select id from profiles')).rowCount).toBe(0);
    });
    it('candidate cannot edit config or skills', async () => {
      expect((await as(ids.candA, `update config set value = '{}' where key = 'scoring'`)).rowCount).toBe(0);
      await expectDenied(ids.candA, `insert into skills(slug, name, category) values ('x','x','x')`);
    });
    it('super admin can read everyone and edit config', async () => {
      expect((await as(ids.superAdmin, 'select id from profiles')).rowCount).toBe(6);
      expect((await as(ids.superAdmin, `update config set value = value where key = 'scoring'`)).rowCount).toBe(1);
      expect((await as(ids.superAdmin, 'select id from questions')).rowCount).toBe(150);
    });
    it('unapproved employer cannot post jobs', async () => {
      await expectDenied(ids.employer, `insert into jobs(employer_id, title) values ($1, 'Intern')`, [ids.employer]);
    });
  });
});

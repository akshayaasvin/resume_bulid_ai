import 'server-only';
import { adminClient } from '../supabase/admin';
import { getConfig } from '../server-config';
import { badgeFor, isBetterScore, isPublicScore, levelFor, type Badge } from '../scoring';
import { answerSchema, gradeAnswer, scorePct, type Answer } from './grading';
import { pickQuestions, sanitizeQuestion, type QuestionRow } from './questions';
import { lockedUntil, verifyPin } from './pin';
import { runSqlOnServer } from './sql-runner';
import { createResumeVersion } from '../resume/versions';
import { track } from '../funnel';

export interface AttemptRow {
  id: string;
  profile_id: string;
  skill_id: string;
  mode: 'self' | 'campus';
  workshop_id: string | null;
  proctor_verified: boolean;
  question_ids: string[];
  tab_switches: number;
  fullscreen_exits: number;
  started_at: string;
  expires_at: string;
  grace_minutes: number;
  submitted_at: string | null;
  status: 'in_progress' | 'submitted' | 'expired';
  flagged: boolean;
  flag_reason: string | null;
  score_pct: number | null;
  badge: Badge | null;
}

export class TestError extends Error {
  constructor(public code: string, public status: number, public extra: Record<string, unknown> = {}) {
    super(code);
  }
}

const QUESTION_COLUMNS = 'id, skill_id, type, difficulty, body, options, correct, test_cases, sql_seed, starter_code, marks';

// ---------------------------------------------------------------------------
// PIN check with lockout
// ---------------------------------------------------------------------------
async function checkPin(profileId: string, deviceId: string, workshopId: string, pin: string) {
  const db = adminClient();
  const cfg = await getConfig('test');
  const now = new Date();
  const since = new Date(now.getTime() - cfg.pinLockMinutes * 60_000).toISOString();

  const { data: ws } = await db
    .from('workshops').select('id, pin_secret, is_demo, demo_pin, is_active, late_grace_minutes')
    .eq('id', workshopId).single();
  if (!ws || !ws.is_active) throw new TestError('workshop_inactive', 400);

  // Failures since each identity's last success, within the lock window.
  const recent = await db
    .from('pin_attempts').select('success, created_at, profile_id, device_id')
    .or(`profile_id.eq.${profileId},device_id.eq.${deviceId}`)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50);
  const rows = (recent.data ?? []) as { success: boolean; created_at: string; profile_id: string | null; device_id: string | null }[];
  const failuresFor = (match: (r: (typeof rows)[number]) => boolean) => {
    const out: Date[] = [];
    for (const r of rows.filter(match)) {
      if (r.success) break;
      out.push(new Date(r.created_at));
    }
    return out;
  };
  const byAccount = failuresFor((r) => r.profile_id === profileId);
  const byDevice = failuresFor((r) => r.device_id === deviceId);
  const lock = [lockedUntil(byAccount, now, cfg.pinMaxWrong, cfg.pinLockMinutes), lockedUntil(byDevice, now, cfg.pinMaxWrong, cfg.pinLockMinutes)]
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (lock) throw new TestError('pin_locked', 423, { until: lock.toISOString() });

  const ok = verifyPin(ws, pin, now, cfg.pinRotateMinutes);
  const failuresAfter = Math.max(byAccount.length, byDevice.length) + (ok ? 0 : 1);
  const nowLocked = !ok && failuresAfter >= cfg.pinMaxWrong;
  await db.from('pin_attempts').insert({
    workshop_id: workshopId, profile_id: profileId, device_id: deviceId, success: ok, locked: nowLocked,
  });
  if (!ok) {
    if (nowLocked) {
      throw new TestError('pin_locked', 423, { until: new Date(now.getTime() + cfg.pinLockMinutes * 60_000).toISOString() });
    }
    throw new TestError('pin_wrong', 403, { left: cfg.pinMaxWrong - failuresAfter });
  }
  return ws as { id: string; late_grace_minutes: number };
}

// ---------------------------------------------------------------------------
// Start (or resume) an attempt
// ---------------------------------------------------------------------------
export async function startAttempt(opts: {
  profileId: string; workshopId: string | null; deviceId: string; skillSlug: string; mode: 'self' | 'campus'; pin?: string;
}) {
  const db = adminClient();
  const cfg = await getConfig('test');

  const { data: skill } = await db.from('skills').select('id, name, is_active').eq('slug', opts.skillSlug).maybeSingle();
  if (!skill || !skill.is_active) throw new TestError('skill_not_found', 404);

  // Resume an open attempt for this skill, or finalize it if it is long past its deadline.
  const { data: open } = await db
    .from('attempts').select('*').eq('profile_id', opts.profileId).eq('skill_id', skill.id)
    .eq('status', 'in_progress').order('started_at', { ascending: false }).limit(1).maybeSingle<AttemptRow>();
  if (open) {
    const hardDeadline = new Date(open.expires_at).getTime() + (open.grace_minutes + cfg.lateHardLimitMinutes) * 60_000;
    if (Date.now() <= hardDeadline) return { attemptId: open.id, resumed: true };
    await finalizeAttempt(open.id, opts.profileId, null);
  }

  let workshopId: string | null = null;
  let grace = cfg.selfModeGraceMinutes;
  let proctorVerified = false;
  if (opts.mode === 'campus') {
    if (!opts.workshopId) throw new TestError('no_workshop', 400);
    if (!opts.pin) throw new TestError('pin_required', 400);
    const ws = await checkPin(opts.profileId, opts.deviceId, opts.workshopId, opts.pin);
    workshopId = ws.id;
    grace = ws.late_grace_minutes;
    proctorVerified = true;
  }

  const { data: pool } = await db
    .from('questions').select('id, type, difficulty').eq('skill_id', skill.id).eq('status', 'published');
  const picked = pickQuestions((pool ?? []) as Pick<QuestionRow, 'id' | 'type' | 'difficulty'>[], cfg, Math.random);
  if (picked.length === 0) throw new TestError('no_questions', 409);

  const now = new Date();
  const { data: attempt, error } = await db
    .from('attempts')
    .insert({
      profile_id: opts.profileId,
      skill_id: skill.id,
      mode: opts.mode,
      workshop_id: workshopId,
      proctor_verified: proctorVerified,
      question_ids: picked.map((q) => q.id),
      started_at: now.toISOString(),
      expires_at: new Date(now.getTime() + cfg.durationMinutes * 60_000).toISOString(),
      grace_minutes: grace,
    })
    .select('id')
    .single();
  if (error || !attempt) throw new TestError('start_failed', 500);
  await track(opts.profileId, 'test_started', { skill: opts.skillSlug, mode: opts.mode });
  return { attemptId: attempt.id as string, resumed: false };
}

// ---------------------------------------------------------------------------
// Load an attempt for the test screen (sanitized)
// ---------------------------------------------------------------------------
export async function loadAttempt(attemptId: string, profileId: string) {
  const db = adminClient();
  const { data: attempt } = await db.from('attempts').select('*, skills(slug, name)').eq('id', attemptId).maybeSingle();
  if (!attempt || attempt.profile_id !== profileId) throw new TestError('not_found', 404);

  const { data: qs } = await db.from('questions').select(QUESTION_COLUMNS).in('id', attempt.question_ids);
  const byId = new Map(((qs ?? []) as QuestionRow[]).map((q) => [q.id, q]));
  const questions = (attempt.question_ids as string[])
    .map((id) => byId.get(id))
    .filter((q): q is QuestionRow => !!q)
    .map((q) => sanitizeQuestion(q, attemptId));

  const { data: saved } = await db.from('attempt_answers').select('question_id, answer').eq('attempt_id', attemptId);
  const answers: Record<string, unknown> = {};
  for (const r of saved ?? []) answers[r.question_id] = r.answer;

  return {
    attempt: {
      id: attempt.id as string,
      skill: attempt.skills as { slug: string; name: string },
      mode: attempt.mode as 'self' | 'campus',
      status: attempt.status as AttemptRow['status'],
      startedAt: attempt.started_at as string,
      expiresAt: attempt.expires_at as string,
      graceMinutes: attempt.grace_minutes as number,
      tabSwitches: attempt.tab_switches as number,
      fullscreenExits: attempt.fullscreen_exits as number,
      flagged: attempt.flagged as boolean,
      scorePct: attempt.score_pct as number | null,
    },
    questions,
    answers,
    serverNow: new Date().toISOString(),
  };
}

function parseAnswers(raw: unknown, allowed: Set<string>): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [qid, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(qid)) continue;
    const p = answerSchema.safeParse(val);
    if (p.success) out[qid] = p.data;
  }
  return out;
}

async function ownedOpenAttempt(attemptId: string, profileId: string) {
  const { data: attempt } = await adminClient().from('attempts').select('*').eq('id', attemptId).maybeSingle<AttemptRow>();
  if (!attempt || attempt.profile_id !== profileId) throw new TestError('not_found', 404);
  return attempt;
}

// ---------------------------------------------------------------------------
// Opportunistic answer sync during the test (no grading)
// ---------------------------------------------------------------------------
export async function saveAnswers(attemptId: string, profileId: string, raw: unknown) {
  const attempt = await ownedOpenAttempt(attemptId, profileId);
  if (attempt.status !== 'in_progress') return { status: attempt.status };
  const cfg = await getConfig('test');
  const hard = new Date(attempt.expires_at).getTime() + (attempt.grace_minutes + cfg.lateHardLimitMinutes) * 60_000;
  if (Date.now() > hard) return { status: 'expired' as const };
  const answers = parseAnswers(raw, new Set(attempt.question_ids));
  const rows = Object.entries(answers).map(([question_id, answer]) => ({
    attempt_id: attemptId, question_id, answer, saved_at: new Date().toISOString(),
  }));
  if (rows.length) await adminClient().from('attempt_answers').upsert(rows);
  return { status: 'in_progress' as const, saved: rows.length };
}

// ---------------------------------------------------------------------------
// Tab switch / fullscreen exit counters
// ---------------------------------------------------------------------------
export async function recordEvent(attemptId: string, profileId: string, kind: 'tab' | 'fullscreen') {
  await ownedOpenAttempt(attemptId, profileId);
  const scoring = await getConfig('scoring');
  const { data } = await adminClient().rpc('bump_attempt_counter', {
    p_attempt: attemptId, p_kind: kind, p_flag_after: scoring.autoFlagAfter,
  });
  const row = (data as { tab_switches: number; fullscreen_exits: number; flagged: boolean }[] | null)?.[0];
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Submit + grade (idempotent)
// ---------------------------------------------------------------------------
export async function finalizeAttempt(attemptId: string, profileId: string, raw: unknown) {
  const db = adminClient();
  const attempt = await ownedOpenAttempt(attemptId, profileId);
  const scoring = await getConfig('scoring');

  if (attempt.status !== 'in_progress') {
    return {
      alreadySubmitted: true,
      scorePct: Number(attempt.score_pct ?? 0),
      level: levelFor(Number(attempt.score_pct ?? 0), scoring),
      badge: attempt.badge ?? 'self',
      flagged: attempt.flagged,
      resumeVersion: null as number | null,
    };
  }

  const testCfg = await getConfig('test');
  const submittedAt = new Date();

  // Merge submitted answers over anything synced earlier.
  const allowed = new Set(attempt.question_ids);
  const incoming = parseAnswers(raw, allowed);
  const { data: saved } = await db.from('attempt_answers').select('question_id, answer').eq('attempt_id', attemptId);
  const answers: Record<string, Answer> = parseAnswers(Object.fromEntries((saved ?? []).map((r) => [r.question_id, r.answer])), allowed);
  Object.assign(answers, incoming);

  const { data: qs } = await db.from('questions').select(QUESTION_COLUMNS).in('id', attempt.question_ids);
  const questions = (qs ?? []) as QuestionRow[];
  const results = await Promise.all(questions.map((q) => gradeAnswer(q, answers[q.id], runSqlOnServer)));
  const pct = scorePct(results, questions);

  const deadline = new Date(attempt.expires_at).getTime() + attempt.grace_minutes * 60_000;
  const hard = deadline + testCfg.lateHardLimitMinutes * 60_000;
  let flagged = attempt.flagged;
  let flagReason = attempt.flag_reason;
  if (submittedAt.getTime() > hard && !flagged) {
    flagged = true;
    flagReason = 'late_submission';
  }
  const badge = badgeFor(
    {
      mode: attempt.mode,
      proctorVerified: attempt.proctor_verified,
      tabSwitches: attempt.tab_switches,
      flagged,
      submittedAt,
      expiresAt: new Date(attempt.expires_at),
      graceMinutes: attempt.grace_minutes,
    },
    scoring,
  );
  const level = levelFor(pct, scoring);

  // Claim the attempt: only one concurrent submit can flip in_progress -> submitted.
  const { data: claimed } = await db
    .from('attempts')
    .update({
      status: 'submitted', submitted_at: submittedAt.toISOString(), score_pct: pct, badge, flagged, flag_reason: flagReason,
    })
    .eq('id', attemptId).eq('status', 'in_progress')
    .select('id');
  if (!claimed || claimed.length === 0) return finalizeAttempt(attemptId, profileId, null);

  await db.from('attempt_answers').upsert(
    questions.map((q, i) => ({
      attempt_id: attemptId,
      question_id: q.id,
      answer: answers[q.id] ?? null,
      is_correct: results[i].isCorrect,
      marks_awarded: results[i].marks,
    })),
  );

  // Best score per skill.
  const { data: existing } = await db
    .from('skill_scores').select('score_pct, badge').eq('profile_id', profileId).eq('skill_id', attempt.skill_id).maybeSingle();
  const prev = existing ? { scorePct: Number(existing.score_pct), badge: existing.badge as Badge } : null;
  let resumeVersion: number | null = null;
  if (isBetterScore({ scorePct: pct, badge }, prev)) {
    await db.from('skill_scores').upsert({
      profile_id: profileId, skill_id: attempt.skill_id, best_attempt_id: attemptId,
      score_pct: pct, level, badge, updated_at: submittedAt.toISOString(),
    });
    // A new verified resume only when something visible on it changed.
    if (isPublicScore(pct, scoring)) {
      resumeVersion = await createResumeVersion(profileId, 'verified');
      await track(profileId, 'verified_resume', { version: resumeVersion });
    }
  }
  await track(profileId, 'test_submitted', { attempt_id: attemptId, score_pct: pct, badge });

  return { alreadySubmitted: false, scorePct: pct, level, badge, flagged, resumeVersion };
}

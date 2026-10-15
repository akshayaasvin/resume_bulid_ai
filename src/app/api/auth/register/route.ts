import { z } from 'zod';
import { adminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { authEmailForPhone, normalizeIndianPhone } from '@/lib/phone';
import { withBackoff } from '@/lib/retry';
import { track } from '@/lib/funnel';
import { hasErrors, isJunkName, validateEducation } from '@/lib/education-validation';
import { onboardingAnswersSchema } from '@/lib/onboarding/catalog';
import { canonicalSkillName, findCatalogSkill, normSkill } from '@/lib/skill-alias';
import { prepareInBackground } from '@/lib/ai/skill-tests';
import { createResumeVersion } from '@/lib/resume/versions';

// May start background question-bank generation for skills without a test (waitUntil).
export const maxDuration = 60;

const text = (max: number) => z.string().trim().max(max);
const year = z.coerce.number().int().min(1950).max(2100).nullable().optional();

const educationItem = z.object({
  id: z.string().uuid(),
  institution: text(200).min(3),
  degree: text(120).min(2),
  field: text(120).nullable().optional(),
  start_year: year,
  end_year: year,
  score: text(20).nullable().optional(),
});

const schema = z.object({
  full_name: z.string().trim().min(2).max(100),
  name_tamil: z.string().trim().max(100).optional().or(z.literal('')),
  phone: z.string().min(10).max(16),
  password: z.string().min(6).max(72),
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  department: z.string().trim().max(100).optional().or(z.literal('')),
  year: z.coerce.number().int().min(1).max(6).optional(),
  college_id: z.string().uuid().optional().or(z.literal('')),
  /** A college that isn't in the list yet (onboarding "My college isn't listed"). */
  college_name: z.string().trim().min(3).max(150).optional().or(z.literal('')),
  batch_code: z.string().trim().toUpperCase().max(32).optional().or(z.literal('')),
  whatsapp_opt_in: z.boolean().default(false),
  /** Must be true: the Privacy Policy and Terms (which cover WhatsApp updates) were accepted. */
  agreed_to_policy: z.boolean().optional(),
  language: z.enum(['en', 'ta']).default('en'),
  /** Goal-based onboarding (steps 1-4) and education (step 6). Absent for the legacy form. */
  onboarding: onboardingAnswersSchema.optional(),
  education: z.array(educationItem).min(1).max(10).optional(),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_input', issues: parsed.error.issues }, { status: 400 });
  const input = parsed.data;
  if (input.agreed_to_policy !== true) return Response.json({ error: 'policy_required' }, { status: 400 });

  const phone = normalizeIndianPhone(input.phone);
  if (!phone) return Response.json({ error: 'invalid_phone' }, { status: 400 });
  // Same rules as the form: junk school/college names, impossible years, bad marks.
  if (input.education?.some((e) => hasErrors(validateEducation({
    ...e, start_year: e.start_year ?? null, end_year: e.end_year ?? null, score: e.score ?? null,
  })))) {
    return Response.json({ error: 'invalid_education' }, { status: 400 });
  }
  if (input.college_name && isJunkName(input.college_name)) return Response.json({ error: 'invalid_college' }, { status: 400 });

  const admin = adminClient();

  let collegeId: string | null = input.college_id || null;
  let workshopId: string | null = null;
  if (input.batch_code) {
    const { data: ws } = await admin
      .from('workshops')
      .select('id, college_id, is_active')
      .eq('batch_code', input.batch_code)
      .maybeSingle<{ id: string; college_id: string; is_active: boolean }>();
    if (!ws || !ws.is_active) return Response.json({ error: 'invalid_batch' }, { status: 400 });
    collegeId = ws.college_id;
    workshopId = ws.id;
  } else if (!collegeId && input.college_name) {
    // Reuse a college with the same name (any case); otherwise add it. Admins can merge near-duplicates.
    const name = input.college_name.replace(/\s+/g, ' ');
    const { data: existing } = await admin.from('colleges').select('id')
      .ilike('name', name.replace(/[%_\\]/g, (c) => `\\${c}`)).limit(1).maybeSingle();
    if (existing) collegeId = existing.id as string;
    else {
      const { data: created } = await admin.from('colleges').insert({ name }).select('id').single();
      collegeId = (created?.id as string | undefined) ?? null;
    }
  }

  const email = authEmailForPhone(phone);
  // Admin API: no per-IP signup rate limit, account is created already confirmed.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  });
  if (createErr || !created.user) {
    const exists = /already|registered|exists/i.test(createErr?.message ?? '');
    return Response.json(
      { error: exists ? 'phone_taken' : 'signup_failed' },
      { status: exists ? 409 : 500 },
    );
  }
  const uid = created.user.id;
  const ob = input.onboarding;

  const { error: profileErr } = await admin.from('profiles').insert({
    id: uid,
    role: 'candidate',
    full_name: input.full_name,
    name_tamil: input.name_tamil || null,
    phone_whatsapp: phone,
    email: input.email || null,
    department: input.department || null,
    year: input.year ?? null,
    college_id: collegeId,
    workshop_id: workshopId,
    // Consent for WhatsApp updates is part of the accepted Privacy Policy (switchable off later).
    whatsapp_opt_in: true,
    opt_in_at: new Date().toISOString(),
    agreed_to_policy: true,
    agreed_at: new Date().toISOString(),
    language: input.language,
    // Onboarding collects skills + education up front, so the profile is complete: go to tests.
    wizard_step: ob ? 4 : 1,
    current_step: ob ? 'tests' : 'wizard',
    ...(ob && {
      goal: ob.goal, english_level: ob.english_level, tamil_level: ob.tamil_level, soft_skills: ob.soft_skills,
    }),
  });
  if (profileErr) {
    await admin.auth.admin.deleteUser(uid);
    const dup = profileErr.code === '23505';
    return Response.json({ error: dup ? 'phone_taken' : 'signup_failed' }, { status: dup ? 409 : 500 });
  }

  if (ob) {
    if (input.education?.length) {
      await admin.from('education').insert(input.education.map((e, i) => ({
        ...e, field: e.field || null, score: e.score || null, profile_id: uid, sort: i,
      })));
    }
    // Technical skills become claimed skills (linked to a test where one exists).
    const { data: catalog } = await admin.from('skills').select('id, name').eq('is_active', true);
    const seen = new Set<string>();
    const claimed = ob.tech_skills.flatMap((raw) => {
      const match = findCatalogSkill(raw, (catalog ?? []) as { id: string; name: string }[]);
      const name = match?.name ?? canonicalSkillName(raw);
      if (seen.has(normSkill(name))) return [];
      seen.add(normSkill(name));
      return [{ profile_id: uid, skill_id: match?.id ?? null, name }];
    });
    if (claimed.length) await admin.from('claimed_skills').insert(claimed);
    // Skills with no test yet: build their question banks in the background right away.
    prepareInBackground(claimed.filter((c) => !c.skill_id).map((c) => c.name), uid);
    await createResumeVersion(uid, 'initial').catch((e) => console.error('initial resume failed', e));
    await track(uid, 'profile_completed', { via: 'onboarding', goal: ob.goal });
  }

  // Session is issued server-side; cookies are written by the SSR client.
  const supabase = createClient();
  const { error: signInErr } = await withBackoff(
    () => supabase.auth.signInWithPassword({ email, password: input.password }),
    (r) => r.error?.status === 429 || (r.error?.status ?? 0) >= 500,
  );

  await track(uid, 'registered', { workshop_id: workshopId });

  if (signInErr) return Response.json({ ok: true, next: '/login?registered=1' });
  return Response.json({ ok: true, next: ob ? '/test' : '/wizard' });
}

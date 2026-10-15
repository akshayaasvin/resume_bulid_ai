import { z } from 'zod';
import { apiSession } from '@/lib/auth';
import { createResumeVersion } from '@/lib/resume/versions';
import { track } from '@/lib/funnel';
import { syncFlowStep } from '@/lib/flow-server';
import { canonicalSkillName, findCatalogSkill, normSkill } from '@/lib/skill-alias';

const year = z.coerce.number().int().min(1950).max(2100).nullable().optional();
const text = (max: number) => z.string().trim().max(max);

const educationItem = z.object({
  id: z.string().uuid(),
  institution: text(200).min(1),
  degree: text(120).min(1),
  field: text(120).nullable().optional(),
  start_year: year,
  end_year: year,
  score: text(20).nullable().optional(),
});

const experienceItem = z.object({
  id: z.string().uuid(),
  type: z.enum(['internship', 'job', 'project']),
  title: text(150).min(1),
  organization: text(150).nullable().optional(),
  start_date: text(20).nullable().optional(),
  end_date: text(20).nullable().optional(),
  description: text(2000).nullable().optional(),
});

const skillItem = z.object({ skill_id: z.string().uuid().nullable(), name: text(60).min(1) });

const schema = z.discriminatedUnion('step', [
  z.object({ step: z.literal(1), advance: z.boolean().default(false), education: z.array(educationItem).max(10) }),
  z.object({ step: z.literal(2), advance: z.boolean().default(false), experience: z.array(experienceItem).max(15) }),
  z.object({
    step: z.literal(3),
    advance: z.boolean().default(false),
    skills: z.array(skillItem).max(30),
    summary: text(800).nullable().optional(),
  }),
]);

/**
 * Autosave endpoint. Upserts the section's rows (client-generated ids) and then deletes rows
 * that are no longer present, so a failure midway never loses existing data. RLS applies.
 */
export async function PUT(req: Request) {
  const auth = await apiSession();
  if ('error' in auth) return auth.error;
  const { supabase, user, profile } = auth.session;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    // field paths + messages only (never the values) so rejected saves can be diagnosed from logs
    console.warn('wizard save rejected', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
    return Response.json({ error: 'invalid_input', issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;
  const uid = user.id;

  async function syncRows(table: 'education' | 'experience', rows: Record<string, unknown>[]) {
    if (rows.length) {
      const { error } = await supabase.from(table).upsert(rows);
      if (error) throw error;
    }
    const keep = rows.map((r) => r.id as string);
    let del = supabase.from(table).delete().eq('profile_id', uid);
    if (keep.length) del = del.not('id', 'in', `(${keep.join(',')})`);
    const { error } = await del;
    if (error) throw error;
  }

  try {
    if (body.step === 1) {
      await syncRows('education', body.education.map((e, i) => ({ ...e, profile_id: uid, sort: i })));
    } else if (body.step === 2) {
      await syncRows(
        'experience',
        body.experience.map((x, i) => ({
          ...x,
          profile_id: uid,
          sort: i,
          bullets: (x.description ?? '').split('\n').map((s) => s.replace(/^[-•*]\s*/, '').trim()).filter(Boolean).slice(0, 8),
        })),
      );
    } else {
      // claimed skills: map aliases onto catalogue skills ("JS" -> JavaScript), dedupe, then replace
      const { data: catalog } = await supabase.from('skills').select('id, name').eq('is_active', true);
      const seen = new Set<string>();
      const skills = body.skills
        .map((s) => {
          const match = findCatalogSkill(s.name, (catalog ?? []) as { id: string; name: string }[]);
          return match ? { skill_id: match.id, name: match.name } : { skill_id: s.skill_id, name: canonicalSkillName(s.name) };
        })
        .filter((s) => {
          const k = normSkill(s.name);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      const { error: delErr } = await supabase.from('claimed_skills').delete().eq('profile_id', uid);
      if (delErr) throw delErr;
      if (skills.length) {
        const { error } = await supabase.from('claimed_skills').insert(skills.map((s) => ({ ...s, profile_id: uid })));
        if (error) throw error;
      }
      if (body.summary !== undefined) {
        const { error } = await supabase.from('profiles').update({ summary: body.summary || null }).eq('id', uid);
        if (error) throw error;
      }
    }

    const nextStep = body.advance ? body.step + 1 : body.step;
    if (nextStep > profile.wizard_step) {
      await supabase.from('profiles').update({ wizard_step: nextStep }).eq('id', uid);
    }

    // Finishing the wizard creates resume v1 (once).
    let resumeVersion: number | null = null;
    if (body.step === 3 && body.advance) {
      const { count } = await supabase.from('resumes').select('id', { count: 'exact', head: true }).eq('profile_id', uid);
      if (!count) {
        resumeVersion = await createResumeVersion(uid, 'initial');
        await track(uid, 'profile_completed');
      }
      await syncFlowStep(uid);
    }
    return Response.json({ ok: true, wizard_step: Math.max(nextStep, profile.wizard_step), resumeVersion });
  } catch (e) {
    console.error('wizard save failed', e);
    return Response.json({ error: 'save_failed' }, { status: 500 });
  }
}

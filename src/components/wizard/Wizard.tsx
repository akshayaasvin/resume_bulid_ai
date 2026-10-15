'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n/client';
import { putJson, useAutosave, type SaveResult, type SaveState } from '@/lib/useAutosave';
import {
  EDU_FIELDS, educationValid, isBlankEducation, sanitizeScoreInput, validateEducation, yearMax, type EduError, type EduField,
} from '@/lib/education-validation';
import { canonicalSkillName, findCatalogSkill, normSkill, suggestSkills } from '@/lib/skill-alias';
import { RunnerStatus } from '../RunnerStatus';
import type { RunnerKind } from '@/lib/runner/client';

export interface EducationRow {
  id: string; institution: string; degree: string; field: string | null;
  start_year: number | null; end_year: number | null; score: string | null;
}
export interface ExperienceRow {
  id: string; type: 'internship' | 'job' | 'project'; title: string; organization: string | null;
  start_date: string | null; end_date: string | null; description: string | null;
}
export interface SkillRow { skill_id: string | null; name: string }
export interface WizardData { education: EducationRow[]; experience: ExperienceRow[]; skills: SkillRow[]; summary: string }

interface CatalogSkill { id: string; slug: string; name: string; category: string }

const uuid = () => crypto.randomUUID();
const emptyEdu = (): EducationRow => ({ id: uuid(), institution: '', degree: '', field: '', start_year: null, end_year: null, score: '' });
const emptyExp = (): ExperienceRow => ({ id: uuid(), type: 'project', title: '', organization: '', start_date: '', end_date: '', description: '' });

const SUGGESTED = ['MS Word', 'PowerPoint', 'Java', 'C', 'C++', 'HTML/CSS', 'JavaScript', 'Tally', 'Canva', 'AutoCAD', 'Teamwork', 'Public speaking'];

const put = (body: unknown) => putJson('/api/wizard', body);

// Blank cards (e.g. a freshly added one) are not sent; filled cards must pass validation first.
const validEdu = (rows: EducationRow[]) => rows.filter((e) => !isBlankEducation(e));
const validExp = (rows: ExperienceRow[]) => rows.filter((e) => e.title.trim());
const toYear = (v: string) => (v ? Number(v) : null);

function SaveBadge({ state }: { state: SaveState }) {
  const { t } = useT();
  const map: Record<SaveState, [string, string]> = {
    idle: ['', ''],
    saving: [t('common.saving'), 'text-slate-500'],
    saved: [t('common.saved'), 'text-green-700'],
    offline: [t('common.offlineSaved'), 'text-amber-700'],
    rejected: [t('save.rejected'), 'text-red-600'],
    error: [t('save.error'), 'text-red-600'],
  };
  const [label, cls] = map[state];
  return <span className={`text-xs ${cls}`} aria-live="polite">{label}</span>;
}

/** Inline error under a field (red), linked to the input via aria-describedby. */
function FieldError({ id, code }: { id: string; code?: EduError }) {
  const { t } = useT();
  if (!code) return null;
  return <p id={id} className="mt-1 text-xs text-red-600">{t(`wizard.err.${code}`, { min: 1970, max: yearMax() })}</p>;
}

export function Wizard({ userId, initial, startStep, wizardStep, catalog, done }: {
  userId: string; initial: WizardData; startStep: number; wizardStep: number; catalog: CatalogSkill[]; done: boolean;
}) {
  const { t } = useT();
  const router = useRouter();
  const [step, setStep] = useState(startStep);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [education, setEducation] = useState<EducationRow[]>(initial.education.length ? initial.education : [emptyEdu()]);
  const [experience, setExperience] = useState<ExperienceRow[]>(initial.experience);
  const [skills, setSkills] = useState<SkillRow[]>(initial.skills);
  const [summary, setSummary] = useState(initial.summary);
  const [custom, setCustom] = useState('');

  // Steps the candidate has moved past. Sent with every background save so the server records
  // progress even if the save that carried "Next" happened offline (the server never moves back).
  const advanced = useRef(new Set<number>([1, 2, 3].filter((n) => n < wizardStep)));
  const eduSave = useAutosave<EducationRow[]>(
    `wizard:${userId}:1`,
    (rows) => put({ step: 1, advance: advanced.current.has(1), education: validEdu(rows) }),
    { canSave: (rows) => educationValid(rows) },
  );
  const expSave = useAutosave<ExperienceRow[]>(`wizard:${userId}:2`, (rows) => put({ step: 2, advance: advanced.current.has(2), experience: validExp(rows) }));
  const skillSave = useAutosave<{ skills: SkillRow[]; summary: string }>(`wizard:${userId}:3`, (d) => put({ step: 3, ...d }));

  // Inline validation for Education: shown once a field is left, or for everything after "Next".
  const eduErrors = useMemo(() => education.map((e) => validateEducation(e)), [education]);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [showAllEduErrors, setShowAllEduErrors] = useState(false);
  const touch = (rowId: string, f: EduField) => setTouched((s) => (s.has(`${rowId}:${f}`) ? s : new Set(s).add(`${rowId}:${f}`)));
  const eduError = (i: number, f: EduField) =>
    showAllEduErrors || touched.has(`${education[i].id}:${f}`) ? eduErrors[i]?.[f] : undefined;
  const fieldId = (rowId: string, f: EduField) => `edu-${rowId}-${f}`;
  const invalidCls = (bad: unknown) => (bad ? ' border-red-500 focus:border-red-500 focus:ring-red-200' : '');

  // Restore unsynced drafts left on this phone (e.g. WiFi dropped before the save landed).
  useEffect(() => {
    const e = eduSave.readDraft(); if (e) { setEducation(e); eduSave.queue(e); }
    const x = expSave.readDraft(); if (x) { setExperience(x); expSave.queue(x); }
    const s = skillSave.readDraft(); if (s) { setSkills(s.skills); setSummary(s.summary); skillSave.queue(s); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Retry anything still waiting (e.g. saved offline) whenever the candidate changes step.
  const { flush: flushEdu } = eduSave;
  const { flush: flushExp } = expSave;
  const { flush: flushSkills } = skillSave;
  useEffect(() => {
    void flushEdu(); void flushExp(); void flushSkills();
  }, [step, flushEdu, flushExp, flushSkills]);

  const runnerKinds = useMemo<RunnerKind[]>(() => {
    const slugs = new Set(skills.map((s) => catalog.find((c) => c.id === s.skill_id)?.slug ?? s.name.toLowerCase()));
    const kinds: RunnerKind[] = [];
    if (slugs.has('python')) kinds.push('python');
    if (slugs.has('sql')) kinds.push('sql');
    return kinds;
  }, [skills, catalog]);

  const updEdu = (rows: EducationRow[]) => { setEducation(rows); eduSave.queue(rows); };
  const updExp = (rows: ExperienceRow[]) => { setExperience(rows); expSave.queue(rows); };
  const updSkills = (rows: SkillRow[], sum = summary) => { setSkills(rows); skillSave.queue({ skills: rows, summary: sum }); };

  // Typed skills resolve through aliases ("JS" -> JavaScript) so they match a test.
  const addSkill = (typed: string) => {
    const match = findCatalogSkill(typed, catalog);
    const name = match?.name ?? canonicalSkillName(typed);
    if (name && !skills.some((s) => normSkill(s.name) === normSkill(name))) {
      updSkills([...skills, { skill_id: match?.id ?? null, name }]);
    }
    setCustom('');
  };
  const suggestions = useMemo(
    () => suggestSkills(custom, catalog).filter((c) => !skills.some((s) => normSkill(s.name) === normSkill(c.name))),
    [custom, catalog, skills],
  );
  // Catalogue skills first; extra suggestions only when they aren't already a catalogue skill.
  const chipOptions = useMemo(() => {
    const opts: SkillRow[] = catalog.map((c) => ({ skill_id: c.id, name: c.name }));
    const seen = new Set(opts.map((o) => normSkill(o.name)));
    for (const s of [...SUGGESTED.map((n) => ({ skill_id: null, name: n })), ...skills.filter((s) => !s.skill_id)]) {
      const k = normSkill(canonicalSkillName(s.name));
      if (!seen.has(k)) { seen.add(k); opts.push(s); }
    }
    return opts;
  }, [catalog, skills]);

  const saveMessage = (r: SaveResult) =>
    r === 'offline' ? t('wizard.finishOffline') : r === 'rejected' ? t('save.rejected') : t('save.error');

  function goTo(n: number) {
    setStep(n);
    window.scrollTo({ top: 0 });
  }

  /** Focuses the first invalid Education field; returns false when the step is valid. */
  function focusFirstEduError(): boolean {
    for (let i = 0; i < education.length; i++) {
      const f = EDU_FIELDS.find((k) => eduErrors[i]?.[k]);
      if (f) {
        const el = document.getElementById(fieldId(education[i].id, f));
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el?.focus({ preventScroll: true });
        return true;
      }
    }
    return false;
  }

  async function advance() {
    setError(null);
    // Steps 1-2: validate, keep a copy on the phone, move on at once; the server save runs in the background.
    if (step === 1) {
      if (focusFirstEduError()) {
        setShowAllEduErrors(true);
        setError(t('wizard.fixFields'));
        return;
      }
      advanced.current.add(1);
      eduSave.queue(education);
      void eduSave.flush();
      goTo(2);
      return;
    }
    if (step === 2) {
      advanced.current.add(2);
      expSave.queue(experience);
      void expSave.flush();
      goTo(3);
      return;
    }
    // Step 3 finishes the profile: the next page is server-gated, so this one must reach the server.
    setBusy(true);
    try {
      // Re-send every section (not just pending ones) so an earlier failed background save can't be skipped.
      eduSave.queue(education);
      expSave.queue(experience);
      skillSave.queue({ skills, summary });
      for (const pending of [eduSave.flush, expSave.flush, skillSave.flush]) {
        const r = await pending();
        if (r && r !== 'ok') { setError(saveMessage(r)); return; }
      }
      const r = await put({ step: 3, advance: true, skills, summary });
      if (r !== 'ok') { setError(saveMessage(r)); return; }
      router.push('/test');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // Background saves from earlier steps still matter (e.g. Education saved offline while on step 2).
  const allStates = [eduSave.state, expSave.state, skillSave.state];
  const saveState: SaveState = (['rejected', 'error', 'offline'] as const).find((s) => allStates.includes(s))
    ?? (step === 1 ? eduSave.state : step === 2 ? expSave.state : skillSave.state);
  const titles = ['wizard.education', 'wizard.experience', 'wizard.skills'];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">{t('wizard.step', { n: step })}</p>
          <h1 className="text-2xl font-bold">{t(titles[step - 1])}</h1>
        </div>
        <SaveBadge state={saveState} />
      </div>
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3].map((n) => (
          <button key={n} type="button" onClick={() => (n < step || done) && setStep(n)}
            className={`h-1.5 flex-1 rounded-full ${n <= step ? 'bg-brand-600' : 'bg-slate-200'}`} />
        ))}
      </div>
      <RunnerStatus kinds={runnerKinds} />

      {step === 1 && (
        <div className="space-y-4">
          {education.map((e, i) => (
            <fieldset key={e.id} className="card space-y-3">
              <div>
                <label className="label" htmlFor={fieldId(e.id, 'institution')}>{t('wizard.institution')}</label>
                <input id={fieldId(e.id, 'institution')} className={`input${invalidCls(eduError(i, 'institution'))}`} value={e.institution} maxLength={200}
                  aria-invalid={!!eduError(i, 'institution')} aria-describedby={`${fieldId(e.id, 'institution')}-err`}
                  onBlur={() => touch(e.id, 'institution')}
                  onChange={(ev) => updEdu(education.map((x, j) => (j === i ? { ...x, institution: ev.target.value } : x)))} />
                <FieldError id={`${fieldId(e.id, 'institution')}-err`} code={eduError(i, 'institution')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor={fieldId(e.id, 'degree')}>{t('wizard.degree')}</label>
                  <input id={fieldId(e.id, 'degree')} className={`input${invalidCls(eduError(i, 'degree'))}`} value={e.degree} maxLength={120} placeholder="B.E. / 12th"
                    aria-invalid={!!eduError(i, 'degree')} aria-describedby={`${fieldId(e.id, 'degree')}-err`}
                    onBlur={() => touch(e.id, 'degree')}
                    onChange={(ev) => updEdu(education.map((x, j) => (j === i ? { ...x, degree: ev.target.value } : x)))} />
                  <FieldError id={`${fieldId(e.id, 'degree')}-err`} code={eduError(i, 'degree')} />
                </div>
                <div>
                  <label className="label">{t('wizard.field')}</label>
                  <input className="input" value={e.field ?? ''} maxLength={120} placeholder="CSE"
                    onChange={(ev) => updEdu(education.map((x, j) => (j === i ? { ...x, field: ev.target.value } : x)))} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label" htmlFor={fieldId(e.id, 'start_year')}>{t('wizard.startYear')}</label>
                  <input id={fieldId(e.id, 'start_year')} className={`input${invalidCls(eduError(i, 'start_year'))}`}
                    inputMode="numeric" pattern="[0-9]*" maxLength={4} value={e.start_year ?? ''}
                    aria-invalid={!!eduError(i, 'start_year')} aria-describedby={`${fieldId(e.id, 'start_year')}-err`}
                    onBlur={() => touch(e.id, 'start_year')}
                    onChange={(ev) => updEdu(education.map((x, j) => (j === i ? { ...x, start_year: toYear(ev.target.value.replace(/\D/g, '')) } : x)))} />
                  <FieldError id={`${fieldId(e.id, 'start_year')}-err`} code={eduError(i, 'start_year')} />
                </div>
                <div>
                  <label className="label" htmlFor={fieldId(e.id, 'end_year')}>{t('wizard.endYear')}</label>
                  <input id={fieldId(e.id, 'end_year')} className={`input${invalidCls(eduError(i, 'end_year'))}`}
                    inputMode="numeric" pattern="[0-9]*" maxLength={4} value={e.end_year ?? ''}
                    aria-invalid={!!eduError(i, 'end_year')} aria-describedby={`${fieldId(e.id, 'end_year')}-err`}
                    onBlur={() => touch(e.id, 'end_year')}
                    onChange={(ev) => updEdu(education.map((x, j) => (j === i ? { ...x, end_year: toYear(ev.target.value.replace(/\D/g, '')) } : x)))} />
                  <FieldError id={`${fieldId(e.id, 'end_year')}-err`} code={eduError(i, 'end_year')} />
                </div>
                <div>
                  <label className="label" htmlFor={fieldId(e.id, 'score')}>{t('wizard.score')}</label>
                  <input id={fieldId(e.id, 'score')} className={`input${invalidCls(eduError(i, 'score'))}`}
                    inputMode="decimal" maxLength={10} value={e.score ?? ''}
                    aria-invalid={!!eduError(i, 'score')} aria-describedby={`${fieldId(e.id, 'score')}-err`}
                    onBlur={() => touch(e.id, 'score')}
                    onChange={(ev) => updEdu(education.map((x, j) => (j === i ? { ...x, score: sanitizeScoreInput(ev.target.value) } : x)))} />
                  <FieldError id={`${fieldId(e.id, 'score')}-err`} code={eduError(i, 'score')} />
                </div>
              </div>
              {education.length > 1 && (
                <button type="button" className="text-sm text-red-600" onClick={() => updEdu(education.filter((_, j) => j !== i))}>
                  {t('common.remove')}
                </button>
              )}
            </fieldset>
          ))}
          {education.length < 10 && (
            <button type="button" className="btn-ghost w-full" onClick={() => updEdu([...education, emptyEdu()])}>
              + {t('wizard.addEducation')}
            </button>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {experience.length === 0 && <p className="text-sm text-slate-600">{t('wizard.noExperience')}</p>}
          {experience.map((x, i) => (
            <fieldset key={x.id} className="card space-y-3">
              <div>
                <label className="label">{t('wizard.expType')}</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['project', 'internship', 'job'] as const).map((ty) => (
                    <button key={ty} type="button"
                      className={`rounded-xl border px-2 py-2 text-sm ${x.type === ty ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700' : 'border-slate-300'}`}
                      onClick={() => updExp(experience.map((r, j) => (j === i ? { ...r, type: ty } : r)))}>
                      {t(`wizard.type.${ty}`)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label">{t('wizard.expTitle')}</label>
                <input className="input" value={x.title} maxLength={150}
                  onChange={(ev) => updExp(experience.map((r, j) => (j === i ? { ...r, title: ev.target.value } : r)))} />
              </div>
              <div>
                <label className="label">{t('wizard.org')}</label>
                <input className="input" value={x.organization ?? ''} maxLength={150}
                  onChange={(ev) => updExp(experience.map((r, j) => (j === i ? { ...r, organization: ev.target.value } : r)))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('wizard.start')}</label>
                  <input className="input" value={x.start_date ?? ''} maxLength={20} placeholder="Jun 2024"
                    onChange={(ev) => updExp(experience.map((r, j) => (j === i ? { ...r, start_date: ev.target.value } : r)))} />
                </div>
                <div>
                  <label className="label">{t('wizard.end')}</label>
                  <input className="input" value={x.end_date ?? ''} maxLength={20} placeholder="Jul 2024"
                    onChange={(ev) => updExp(experience.map((r, j) => (j === i ? { ...r, end_date: ev.target.value } : r)))} />
                </div>
              </div>
              <div>
                <label className="label">{t('wizard.description')}</label>
                <textarea className="input min-h-[96px]" value={x.description ?? ''} maxLength={2000}
                  onChange={(ev) => updExp(experience.map((r, j) => (j === i ? { ...r, description: ev.target.value } : r)))} />
              </div>
              <button type="button" className="text-sm text-red-600" onClick={() => updExp(experience.filter((_, j) => j !== i))}>
                {t('common.remove')}
              </button>
            </fieldset>
          ))}
          {experience.length < 15 && (
            <button type="button" className="btn-ghost w-full" onClick={() => updExp([...experience, emptyExp()])}>
              + {t('wizard.addExperience')}
            </button>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">{t('wizard.skillsHint')}</p>
          <div className="flex flex-wrap gap-2">
            {chipOptions.map((opt) => {
                const on = skills.some((s) => s.name.toLowerCase() === opt.name.toLowerCase());
                return (
                  <button key={opt.name} type="button" aria-pressed={on}
                    className={`rounded-full border px-3 py-2 text-sm ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
                    onClick={() => updSkills(on ? skills.filter((s) => s.name.toLowerCase() !== opt.name.toLowerCase()) : [...skills, opt])}>
                    {on ? '✓ ' : ''}{opt.name}
                  </button>
                );
              })}
          </div>
          <form className="flex gap-2" onSubmit={(e) => {
            e.preventDefault();
            addSkill(custom);
          }}>
            <input className="input" placeholder={t('wizard.customSkill')} value={custom} maxLength={60}
              autoComplete="off" aria-describedby={suggestions.length ? 'skill-suggestions' : undefined}
              onChange={(e) => setCustom(e.target.value)} />
            <button className="btn-secondary shrink-0" type="submit">{t('common.add')}</button>
          </form>
          {suggestions.length > 0 && (
            <div id="skill-suggestions" className="-mt-2 space-y-1">
              <p className="text-xs text-slate-500">{t('wizard.skillSuggest')}</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((c) => (
                  <button key={c.id} type="button" onClick={() => addSkill(c.name)}
                    className="rounded-full border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-brand-700">
                    + {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className="label" htmlFor="summary">{t('wizard.summary')}</label>
            <textarea id="summary" className="input min-h-[96px]" value={summary} maxLength={800}
              onChange={(e) => { setSummary(e.target.value); updSkills(skills, e.target.value); }} />
          </div>
        </div>
      )}

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white p-3">
        <div className="mx-auto flex max-w-2xl gap-3">
          {step > 1 && (
            <button type="button" className="btn-secondary flex-1" onClick={() => setStep(step - 1)}>{t('common.back')}</button>
          )}
          <button type="button" className="btn-primary flex-[2]" disabled={busy} onClick={advance}>
            {busy ? t('common.saving') : step === 3 ? t('wizard.finish') : t('common.next')}
          </button>
        </div>
      </div>
    </div>
  );
}

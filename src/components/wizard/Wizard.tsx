'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/i18n/client';
import { useAutosave, type SaveState } from '@/lib/useAutosave';
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

async function put(body: unknown): Promise<{ ok: boolean; data?: { wizard_step: number } }> {
  const res = await fetch('/api/wizard', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: res.ok ? await res.json() : undefined };
}

// Incomplete rows (e.g. a freshly added blank card) are not sent until filled in.
const validEdu = (rows: EducationRow[]) => rows.filter((e) => e.institution.trim() && e.degree.trim());
const validExp = (rows: ExperienceRow[]) => rows.filter((e) => e.title.trim());
const toYear = (v: string) => (v ? Number(v) : null);

function SaveBadge({ state }: { state: SaveState }) {
  const { t } = useT();
  const map: Record<SaveState, [string, string]> = {
    idle: ['', ''],
    saving: [t('common.saving'), 'text-slate-500'],
    saved: [t('common.saved'), 'text-green-700'],
    offline: [t('common.offlineSaved'), 'text-amber-700'],
    error: [t('common.offlineSaved'), 'text-amber-700'],
  };
  const [label, cls] = map[state];
  return <span className={`text-xs ${cls}`} aria-live="polite">{label}</span>;
}

export function Wizard({ userId, initial, startStep, catalog, done }: {
  userId: string; initial: WizardData; startStep: number; catalog: CatalogSkill[]; done: boolean;
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

  const eduSave = useAutosave<EducationRow[]>(`wizard:${userId}:1`, async (rows) => (await put({ step: 1, education: validEdu(rows) })).ok);
  const expSave = useAutosave<ExperienceRow[]>(`wizard:${userId}:2`, async (rows) => (await put({ step: 2, experience: validExp(rows) })).ok);
  const skillSave = useAutosave<{ skills: SkillRow[]; summary: string }>(`wizard:${userId}:3`, async (d) => (await put({ step: 3, ...d })).ok);

  // Restore unsynced drafts left on this phone (e.g. WiFi dropped before the save landed).
  useEffect(() => {
    const e = eduSave.readDraft(); if (e) { setEducation(e); eduSave.queue(e); }
    const x = expSave.readDraft(); if (x) { setExperience(x); expSave.queue(x); }
    const s = skillSave.readDraft(); if (s) { setSkills(s.skills); setSummary(s.summary); skillSave.queue(s); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function advance() {
    setError(null);
    setBusy(true);
    try {
      let res;
      if (step === 1) {
        await eduSave.flush();
        res = await put({ step: 1, advance: true, education: validEdu(education) });
      } else if (step === 2) {
        await expSave.flush();
        res = await put({ step: 2, advance: true, experience: validExp(experience) });
      } else {
        await skillSave.flush();
        res = await put({ step: 3, advance: true, skills, summary });
      }
      if (!res.ok) throw new Error('save failed');
      if (step < 3) {
        setStep(step + 1);
        window.scrollTo({ top: 0 });
      } else {
        router.push('/test');
        router.refresh();
      }
    } catch {
      setError(t('common.offlineSaved'));
    } finally {
      setBusy(false);
    }
  }

  const saveState = step === 1 ? eduSave.state : step === 2 ? expSave.state : skillSave.state;
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
                <label className="label">{t('wizard.institution')}</label>
                <input className="input" value={e.institution} maxLength={200}
                  onChange={(ev) => updEdu(education.map((x, j) => (j === i ? { ...x, institution: ev.target.value } : x)))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('wizard.degree')}</label>
                  <input className="input" value={e.degree} maxLength={120} placeholder="B.E. / 12th"
                    onChange={(ev) => updEdu(education.map((x, j) => (j === i ? { ...x, degree: ev.target.value } : x)))} />
                </div>
                <div>
                  <label className="label">{t('wizard.field')}</label>
                  <input className="input" value={e.field ?? ''} maxLength={120} placeholder="CSE"
                    onChange={(ev) => updEdu(education.map((x, j) => (j === i ? { ...x, field: ev.target.value } : x)))} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">{t('wizard.startYear')}</label>
                  <input className="input" inputMode="numeric" maxLength={4} value={e.start_year ?? ''}
                    onChange={(ev) => updEdu(education.map((x, j) => (j === i ? { ...x, start_year: toYear(ev.target.value.replace(/\D/g, '')) } : x)))} />
                </div>
                <div>
                  <label className="label">{t('wizard.endYear')}</label>
                  <input className="input" inputMode="numeric" maxLength={4} value={e.end_year ?? ''}
                    onChange={(ev) => updEdu(education.map((x, j) => (j === i ? { ...x, end_year: toYear(ev.target.value.replace(/\D/g, '')) } : x)))} />
                </div>
                <div>
                  <label className="label">{t('wizard.score')}</label>
                  <input className="input" value={e.score ?? ''} maxLength={20}
                    onChange={(ev) => updEdu(education.map((x, j) => (j === i ? { ...x, score: ev.target.value } : x)))} />
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

      {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}

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

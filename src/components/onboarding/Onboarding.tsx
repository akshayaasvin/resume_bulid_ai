'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/i18n/client';
import {
  EDU_FIELDS, isBlankEducation, isJunkName, validateEducation, yearMax, type EduError, type EduField,
} from '@/lib/education-validation';
import { sanitizeScoreInput } from '@/lib/education-validation';
import { GOALS, LEVELS, SOFT_SKILLS, TECH_SKILL_GROUPS, type Goal, type Level } from '@/lib/onboarding/catalog';
import { matchRoles } from '@/lib/onboarding/roles';
import { canonicalSkillName, normSkill } from '@/lib/skill-alias';

/**
 * Goal-based onboarding: goal -> languages -> soft skills -> technical skills -> roles that fit
 * (value first) -> personal details + education (creates the account). One question per screen;
 * answers are kept on the phone after every change so the candidate can resume where they left off.
 */
interface Edu { id: string; institution: string; degree: string; field: string; start_year: number | null; end_year: number | null; score: string }
interface State {
  step: number;
  goal: Goal | null;
  english_level: Level | null;
  tamil_level: Level | null;
  soft_skills: string[];
  tech_skills: string[];
  full_name: string; phone: string; email: string;
  college_id: string; college_other: boolean; college_name: string;
  department: string; year: string;
  education: Edu[];
  opt_in: boolean;
}

const STORAGE_KEY = 'onboarding:v1';
const TOTAL = 6;
const newEdu = (): Edu => ({ id: crypto.randomUUID(), institution: '', degree: '', field: '', start_year: null, end_year: null, score: '' });
const initialState = (): State => ({
  step: 1, goal: null, english_level: null, tamil_level: null, soft_skills: [], tech_skills: [],
  full_name: '', phone: '', email: '', college_id: '', college_other: false, college_name: '', department: '', year: '',
  education: [newEdu()], opt_in: false,
});
const toYear = (v: string) => (v ? Number(v) : null);
const has = (list: string[], s: string) => list.some((x) => normSkill(x) === normSkill(s));

const SERVER_ERRORS: Record<string, string> = {
  phone_taken: 'auth.phoneTaken', invalid_phone: 'auth.invalidPhone', invalid_batch: 'auth.invalidBatch',
  rate_limited: 'auth.rateLimited', invalid_education: 'wizard.fixFields', invalid_college: 'wizard.err.junk',
};

export function Onboarding({ colleges, batch }: {
  colleges: { id: string; name: string }[];
  batch?: { code: string; name: string; college: string };
}) {
  const { t, lang } = useT();
  const router = useRouter();
  const [s, setS] = useState<State>(initialState);
  const [restored, setRestored] = useState(false);
  const [password, setPassword] = useState(''); // never stored on the phone
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);

  // Resume where the candidate left off.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = { ...initialState(), ...(JSON.parse(raw) as Partial<State>) };
        if (!saved.education.length) saved.education = [newEdu()];
        setS(saved);
        if (saved.step > 1) setRestored(true);
      }
    } catch { /* storage unavailable */ }
  }, []);
  const update = (patch: Partial<State>) => setS((prev) => {
    const next = { ...prev, ...patch };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });
  const go = (step: number) => { setError(null); setShowErrors(false); update({ step }); window.scrollTo({ top: 0 }); };

  const roles = useMemo(() => matchRoles({
    goal: s.goal, englishLevel: s.english_level, softSkills: s.soft_skills, techSkills: s.tech_skills,
  }), [s.goal, s.english_level, s.soft_skills, s.tech_skills]);

  // ---- step 6 validation -------------------------------------------------------------------
  const phoneDigits = s.phone.replace(/\D/g, '').slice(-10);
  const eduErrors = s.education.map((e) => validateEducation(e));
  const filledEdu = s.education.filter((e) => !isBlankEducation(e));
  const personalErrors = {
    full_name: !/^[A-Za-z][A-Za-z .'-]{1,99}$/.test(s.full_name.trim()) ? 'ob.err.name' : null,
    phone: !/^[6-9]\d{9}$/.test(phoneDigits) ? 'auth.invalidPhone' : null,
    password: password.length < 6 ? 'ob.err.password' : null,
    email: s.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email) ? 'ob.err.email' : null,
    college_name: !batch && s.college_other && (s.college_name.trim().length < 3 || isJunkName(s.college_name)) ? 'wizard.err.junk' : null,
    education: filledEdu.length === 0 ? 'ob.err.education' : null,
  };
  const firstInvalidId = (): string | null => {
    for (const [k, v] of Object.entries(personalErrors)) if (v && k !== 'education') return `ob-${k}`;
    for (let i = 0; i < s.education.length; i++) {
      const f = EDU_FIELDS.find((x) => eduErrors[i][x]);
      if (f) return `ob-edu-${s.education[i].id}-${f}`;
    }
    return personalErrors.education ? `ob-edu-${s.education[0].id}-institution` : null;
  };

  function next() {
    setError(null);
    if (s.step === 1 && !s.goal) return setError(t('ob.pickOne'));
    if (s.step === 2 && (!s.english_level || !s.tamil_level)) return setError(t('ob.pickOne'));
    if (s.step === 4 && s.tech_skills.length === 0) return setError(t('ob.pickTech'));
    if (s.step < TOTAL) go(s.step + 1);
  }

  async function submit() {
    setError(null);
    const bad = firstInvalidId();
    if (bad) {
      setShowErrors(true);
      setError(t('wizard.fixFields'));
      const el = document.getElementById(bad);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus({ preventScroll: true });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          full_name: s.full_name.trim(),
          phone: `+91${phoneDigits}`,
          password,
          email: s.email.trim(),
          department: s.department.trim(),
          year: s.year ? Number(s.year) : undefined,
          college_id: batch || s.college_other ? '' : s.college_id,
          college_name: !batch && s.college_other ? s.college_name.trim() : '',
          batch_code: batch?.code ?? '',
          whatsapp_opt_in: s.opt_in,
          language: lang,
          onboarding: {
            goal: s.goal, english_level: s.english_level, tamil_level: s.tamil_level,
            soft_skills: s.soft_skills, tech_skills: s.tech_skills,
          },
          education: filledEdu.map((e) => ({
            ...e, field: e.field.trim() || null, score: e.score.trim() || null,
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(t(SERVER_ERRORS[body.error] ?? 'common.error'));
        setBusy(false);
        return;
      }
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
      router.push(body.next ?? '/test');
      router.refresh();
    } catch {
      setError(t('common.offlineSaved'));
      setBusy(false);
    }
  }

  // ---- shared bits ----------------------------------------------------------------------------
  const option = (selected: boolean) =>
    `w-full rounded-2xl border px-4 py-3 text-left transition ${selected ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-600' : 'border-slate-300 bg-white'}`;
  const chip = (selected: boolean) =>
    `rounded-full border px-3 py-2 text-sm ${selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`;
  const toggle = (list: string[], v: string) => (has(list, v) ? list.filter((x) => normSkill(x) !== normSkill(v)) : [...list, v]);
  const err = (key: string | null, id: string) =>
    showErrors && key ? <p id={`${id}-err`} className="mt-1 text-xs text-red-600">{t(key)}</p> : null;
  const eduErr = (i: number, f: EduField) => (showErrors ? eduErrors[i][f] : undefined);
  const eduMsg = (code: EduError | undefined, id: string) =>
    code ? <p id={`${id}-err`} className="mt-1 text-xs text-red-600">{t(`wizard.err.${code}`, { min: 1970, max: yearMax() })}</p> : null;
  const red = (bad: unknown) => (bad ? ' border-red-500' : '');

  const q = normSkill(query);
  const custom = query.trim() && !TECH_SKILL_GROUPS.some((g) => g.skills.some((x) => normSkill(x) === normSkill(canonicalSkillName(query))))
    ? canonicalSkillName(query) : null;

  return (
    <div className="pb-28">
      {/* Progress */}
      <div className="mb-5">
        <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
          <span>{t('ob.stepOf', { n: s.step, total: TOTAL })}</span>
          {restored && s.step > 1 && (
            <button type="button" className="underline" onClick={() => { setRestored(false); setPassword(''); setS(initialState()); try { localStorage.removeItem(STORAGE_KEY); } catch { /* */ } }}>
              {t('ob.startOver')}
            </button>
          )}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={1} aria-valuemax={TOTAL} aria-valuenow={s.step}>
          <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${(s.step / TOTAL) * 100}%` }} />
        </div>
        {restored && s.step > 1 && <p className="mt-2 text-xs text-brand-700">{t('ob.resume')}</p>}
      </div>

      {batch && (
        <div className="mb-4 rounded-xl bg-brand-50 p-3 text-sm text-brand-900">
          <div className="font-semibold">{t('auth.joining')}: {batch.name}</div>
          <div>{batch.college} · {batch.code}</div>
        </div>
      )}

      {s.step === 1 && (
        <section className="space-y-3">
          <h1 className="text-2xl font-bold">{t('ob.goal.q')}</h1>
          {GOALS.map((g) => (
            <button key={g} type="button" className={option(s.goal === g)} aria-pressed={s.goal === g}
              onClick={() => { update({ goal: g }); go(2); }}>
              <span className="block font-semibold">{t(`ob.goal.${g}`)}</span>
              <span className="block text-sm text-slate-600">{t(`ob.goal.${g}.d`)}</span>
            </button>
          ))}
        </section>
      )}

      {s.step === 2 && (
        <section className="space-y-5">
          <h1 className="text-2xl font-bold">{t('ob.comm.q')}</h1>
          {(['english_level', 'tamil_level'] as const).map((field) => (
            <fieldset key={field}>
              <legend className="mb-2 font-semibold">{t(field === 'english_level' ? 'ob.comm.english' : 'ob.comm.tamil')}</legend>
              <div className="grid grid-cols-3 gap-2">
                {LEVELS.map((lv) => (
                  <button key={lv} type="button" aria-pressed={s[field] === lv}
                    className={`rounded-xl border px-2 py-3 text-sm ${s[field] === lv ? 'border-brand-600 bg-brand-600 font-semibold text-white' : 'border-slate-300 bg-white'}`}
                    onClick={() => update({ [field]: lv } as Partial<State>)}>
                    {t(`ob.level.${lv}`)}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
        </section>
      )}

      {s.step === 3 && (
        <section className="space-y-3">
          <h1 className="text-2xl font-bold">{t('ob.soft.q')}</h1>
          <p className="text-sm text-slate-600">{t('ob.soft.hint')}</p>
          <div className="flex flex-wrap gap-2">
            {SOFT_SKILLS.map((k) => (
              <button key={k} type="button" aria-pressed={has(s.soft_skills, k)} className={chip(has(s.soft_skills, k))}
                onClick={() => update({ soft_skills: toggle(s.soft_skills, k) })}>
                {has(s.soft_skills, k) ? '✓ ' : ''}{t(`ob.softName.${k}`)}
              </button>
            ))}
          </div>
        </section>
      )}

      {s.step === 4 && (
        <section className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold">{t('ob.tech.q')}</h1>
            <p className="text-sm text-slate-600">{t('ob.tech.hint')}</p>
          </div>
          <input className="input" type="search" placeholder={t('ob.tech.search')} value={query} maxLength={60}
            aria-label={t('ob.tech.search')} onChange={(e) => setQuery(e.target.value)} />
          {custom && (
            <button type="button" className="btn-secondary w-full text-sm"
              onClick={() => { if (!has(s.tech_skills, custom)) update({ tech_skills: [...s.tech_skills, custom] }); setQuery(''); }}>
              + {t('ob.tech.add', { name: custom })}
            </button>
          )}
          {s.tech_skills.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('ob.tech.selected')}</p>
              <div className="flex flex-wrap gap-2">
                {s.tech_skills.map((k) => (
                  <button key={k} type="button" className={chip(true)} onClick={() => update({ tech_skills: toggle(s.tech_skills, k) })}>
                    ✓ {k}
                  </button>
                ))}
              </div>
            </div>
          )}
          {TECH_SKILL_GROUPS.map((g) => {
            const list = g.skills.filter((k) => !q || normSkill(k).includes(q));
            if (!list.length) return null;
            return (
              <div key={g.domain}>
                <h2 className="mb-1 text-sm font-semibold text-slate-700">{t(`ob.domain.${g.domain}`)}</h2>
                <div className="flex flex-wrap gap-2">
                  {list.map((k) => (
                    <button key={k} type="button" aria-pressed={has(s.tech_skills, k)} className={chip(has(s.tech_skills, k))}
                      onClick={() => update({ tech_skills: toggle(s.tech_skills, k) })}>
                      {has(s.tech_skills, k) ? '✓ ' : ''}{k}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {s.step === 5 && (
        <section className="space-y-3">
          <h1 className="text-2xl font-bold">{t('ob.value.title')}</h1>
          {roles.length === 0 ? (
            <div className="card space-y-3 text-sm">
              <p>{t('ob.value.none')}</p>
              <button type="button" className="btn-secondary w-full" onClick={() => go(4)}>{t('ob.tech.q')}</button>
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-600">{t('ob.value.intro')}</p>
              <ol className="space-y-3">
                {roles.map((m, i) => (
                  <li key={m.role.id} className="card">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold"><span className="text-brand-700">{i + 1}.</span> {m.role.title}</p>
                      <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                        {t('ob.value.match', { pct: m.matchPct })}
                      </span>
                    </div>
                    <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
                      {m.skills.length > 0 && <li>{t('ob.reason.skills', { skills: m.skills.join(', ') })}</li>}
                      {m.soft.length > 0 && <li>{t('ob.reason.soft', { skills: m.soft.map((x) => t(`ob.softName.${x}`)).join(', ') })}</li>}
                      {m.goalFit && s.goal && s.goal !== 'not_sure' && <li>{t('ob.reason.goal', { goal: t(`ob.goal.${s.goal}`) })}</li>}
                    </ul>
                  </li>
                ))}
              </ol>
              <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">{t('ob.value.save')}</p>
            </>
          )}
        </section>
      )}

      {s.step === 6 && (
        <section className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold">{t('ob.personal.title')}</h1>
            <p className="text-sm text-slate-600">{t('ob.personal.intro')}</p>
          </div>
          <div>
            <label className="label" htmlFor="ob-full_name">{t('auth.fullName')}</label>
            <input id="ob-full_name" className={`input${red(showErrors && personalErrors.full_name)}`} value={s.full_name} maxLength={100}
              autoComplete="name" aria-describedby="ob-full_name-err" onChange={(e) => update({ full_name: e.target.value })} />
            {err(personalErrors.full_name, 'ob-full_name')}
          </div>
          <div>
            <label className="label" htmlFor="ob-phone">{t('auth.phone')}</label>
            <div className="flex">
              <span className="inline-flex items-center rounded-l-xl border border-r-0 border-slate-300 bg-slate-50 px-3 text-slate-600">+91</span>
              <input id="ob-phone" className={`input rounded-l-none${red(showErrors && personalErrors.phone)}`} inputMode="numeric"
                autoComplete="tel-national" placeholder="98XXXXXXXX" maxLength={14} value={s.phone} aria-describedby="ob-phone-err"
                onChange={(e) => update({ phone: e.target.value })} />
            </div>
            {err(personalErrors.phone, 'ob-phone')}
          </div>
          <div>
            <label className="label" htmlFor="ob-password">{t('auth.password')}</label>
            <input id="ob-password" type="password" className={`input${red(showErrors && personalErrors.password)}`} value={password}
              minLength={6} maxLength={72} autoComplete="new-password" aria-describedby="ob-password-err"
              onChange={(e) => setPassword(e.target.value)} />
            {err(personalErrors.password, 'ob-password')}
          </div>
          <div>
            <label className="label" htmlFor="ob-email">{t('auth.email')}</label>
            <input id="ob-email" type="email" className={`input${red(showErrors && personalErrors.email)}`} value={s.email}
              autoComplete="email" aria-describedby="ob-email-err" onChange={(e) => update({ email: e.target.value })} />
            {err(personalErrors.email, 'ob-email')}
          </div>
          {!batch && (
            <div className="space-y-2">
              <label className="label" htmlFor="ob-college">{t('auth.college')}</label>
              {!s.college_other ? (
                <select id="ob-college" className="input" value={s.college_id} onChange={(e) => update({ college_id: e.target.value })}>
                  <option value="">{t('auth.collegeNone')}</option>
                  {colleges.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              ) : (
                <>
                  <input id="ob-college_name" className={`input${red(showErrors && personalErrors.college_name)}`} value={s.college_name}
                    maxLength={150} placeholder={t('ob.collegeNew')} aria-describedby="ob-college_name-err"
                    onChange={(e) => update({ college_name: e.target.value })} />
                  {err(personalErrors.college_name, 'ob-college_name')}
                </>
              )}
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4" checked={s.college_other}
                  onChange={(e) => update({ college_other: e.target.checked })} />
                {t('ob.collegeOther')}
              </label>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="ob-department">{t('auth.department')}</label>
              <input id="ob-department" className="input" maxLength={100} placeholder="B.E. CSE" value={s.department}
                onChange={(e) => update({ department: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="ob-year">{t('auth.year')}</label>
              <select id="ob-year" className="input" value={s.year} onChange={(e) => update({ year: e.target.value })}>
                <option value="">-</option>
                {[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          <h2 className="pt-2 text-lg font-semibold">{t('wizard.education')}</h2>
          {err(personalErrors.education, 'ob-education')}
          {s.education.map((e, i) => {
            const id = (f: EduField) => `ob-edu-${e.id}-${f}`;
            const set = (patch: Partial<Edu>) => update({ education: s.education.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
            return (
              <fieldset key={e.id} className="card space-y-3">
                <div>
                  <label className="label" htmlFor={id('institution')}>{t('wizard.institution')}</label>
                  <input id={id('institution')} className={`input${red(eduErr(i, 'institution'))}`} value={e.institution} maxLength={200}
                    aria-describedby={`${id('institution')}-err`} onChange={(ev) => set({ institution: ev.target.value })} />
                  {eduMsg(eduErr(i, 'institution'), id('institution'))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label" htmlFor={id('degree')}>{t('wizard.degree')}</label>
                    <input id={id('degree')} className={`input${red(eduErr(i, 'degree'))}`} value={e.degree} maxLength={120} placeholder="B.E. / 12th"
                      aria-describedby={`${id('degree')}-err`} onChange={(ev) => set({ degree: ev.target.value })} />
                    {eduMsg(eduErr(i, 'degree'), id('degree'))}
                  </div>
                  <div>
                    <label className="label" htmlFor={`ob-edu-${e.id}-field`}>{t('wizard.field')}</label>
                    <input id={`ob-edu-${e.id}-field`} className="input" value={e.field} maxLength={120} placeholder="CSE"
                      onChange={(ev) => set({ field: ev.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {(['start_year', 'end_year'] as const).map((f) => (
                    <div key={f}>
                      <label className="label" htmlFor={id(f)}>{t(f === 'start_year' ? 'wizard.startYear' : 'wizard.endYear')}</label>
                      <input id={id(f)} className={`input${red(eduErr(i, f))}`} inputMode="numeric" pattern="[0-9]*" maxLength={4}
                        value={e[f] ?? ''} aria-describedby={`${id(f)}-err`}
                        onChange={(ev) => set({ [f]: toYear(ev.target.value.replace(/\D/g, '')) } as Partial<Edu>)} />
                      {eduMsg(eduErr(i, f), id(f))}
                    </div>
                  ))}
                  <div>
                    <label className="label" htmlFor={id('score')}>{t('wizard.score')}</label>
                    <input id={id('score')} className={`input${red(eduErr(i, 'score'))}`} inputMode="decimal" maxLength={10}
                      value={e.score} aria-describedby={`${id('score')}-err`}
                      onChange={(ev) => set({ score: sanitizeScoreInput(ev.target.value) })} />
                    {eduMsg(eduErr(i, 'score'), id('score'))}
                  </div>
                </div>
                {s.education.length > 1 && (
                  <button type="button" className="text-sm text-red-600" onClick={() => update({ education: s.education.filter((_, j) => j !== i) })}>
                    {t('common.remove')}
                  </button>
                )}
              </fieldset>
            );
          })}
          {s.education.length < 10 && (
            <button type="button" className="btn-ghost w-full" onClick={() => update({ education: [...s.education, newEdu()] })}>
              + {t('wizard.addEducation')}
            </button>
          )}

          <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={s.opt_in} onChange={(e) => update({ opt_in: e.target.checked })} />
            <span className="text-sm text-slate-700">
              {t('auth.optIn')}
              <span className="mt-0.5 block text-xs text-slate-500">{t('ob.optInHint')}</span>
            </span>
          </label>
          <p className="text-center text-sm">
            <Link className="text-brand-700 underline" href="/login">{t('auth.haveAccount')}</Link>
          </p>
        </section>
      )}

      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* Sticky navigation: thumb-reachable on phones. */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white p-3">
        <div className="mx-auto flex max-w-md gap-3">
          {s.step > 1 && (
            <button type="button" className="btn-secondary flex-1" onClick={() => go(s.step - 1)}>{t('common.back')}</button>
          )}
          {s.step < TOTAL ? (
            s.step !== 1 && (
              <button type="button" className="btn-primary flex-[2]" onClick={next} disabled={s.step === 5 && roles.length === 0}>
                {s.step === 5 ? t('ob.value.next') : t('common.next')}
              </button>
            )
          ) : (
            <button type="button" className="btn-primary flex-[2]" onClick={submit} disabled={busy}>
              {busy ? t('common.loading') : t('ob.create')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

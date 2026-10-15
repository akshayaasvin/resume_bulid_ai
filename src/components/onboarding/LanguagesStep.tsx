'use client';
import { useState } from 'react';
import { useT } from '@/i18n/client';
import { EXTRA_LANGUAGES, LEVELS, type Level } from '@/lib/onboarding/catalog';

export interface LangRow { name: string; level: Level | null }

/** Translated label for a language; names typed via "Other" are shown as typed. */
export function useLanguageLabel() {
  const { t } = useT();
  return (name: string) => ((EXTRA_LANGUAGES as readonly string[]).includes(name) ? t(`ob.lang.${name}`) : name);
}

/**
 * Onboarding step 2: English is always there and needs a level; other languages are added from a
 * chip picker (or typed via "Other"), each with a level and a remove button.
 */
export function LanguagesStep({ english, languages, onEnglish, onLanguages }: {
  english: Level | null; languages: LangRow[];
  onEnglish: (l: Level) => void; onLanguages: (rows: LangRow[]) => void;
}) {
  const { t } = useT();
  const label = useLanguageLabel();
  const [picking, setPicking] = useState(false);
  const [other, setOther] = useState<string | null>(null);

  const added = new Set(languages.map((l) => l.name.toLowerCase()));
  const remaining = EXTRA_LANGUAGES.filter((n) => !added.has(n.toLowerCase()));
  const add = (name: string) => {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (clean.length < 2 || clean.toLowerCase() === 'english' || added.has(clean.toLowerCase())) return;
    onLanguages([...languages, { name: clean, level: null }]);
    setPicking(false);
    setOther(null);
  };

  const levels = (value: Level | null, set: (l: Level) => void, name: string) => (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={name}>
      {LEVELS.map((lv) => (
        <button key={lv} type="button" role="radio" aria-checked={value === lv}
          className={`rounded-xl border px-2 py-3 text-sm ${value === lv ? 'border-brand-600 bg-brand-600 font-semibold text-white' : 'border-slate-300 bg-white'}`}
          onClick={() => set(lv)}>
          {t(`ob.level.${lv}`)}
        </button>
      ))}
    </div>
  );

  return (
    <section className="space-y-5">
      <h1 className="text-2xl font-bold">{t('ob.comm.q')}</h1>
      <fieldset>
        <legend className="mb-2 font-semibold">{t('ob.comm.english')} <span className="text-red-600" aria-hidden>*</span></legend>
        {levels(english, onEnglish, t('ob.comm.english'))}
      </fieldset>

      {languages.map((row, i) => (
        <fieldset key={row.name}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <legend className="font-semibold">{label(row.name)}</legend>
            <button type="button" className="rounded-full px-2 text-lg leading-none text-slate-500"
              aria-label={t('ob.lang.remove', { name: label(row.name) })}
              onClick={() => onLanguages(languages.filter((_, j) => j !== i))}>✕</button>
          </div>
          {levels(row.level, (lv) => onLanguages(languages.map((r, j) => (j === i ? { ...r, level: lv } : r))), label(row.name))}
        </fieldset>
      ))}

      {!picking ? (
        <button type="button" className="btn-ghost w-full" onClick={() => setPicking(true)}>{t('ob.lang.add')}</button>
      ) : (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap gap-2">
            {remaining.map((n) => (
              <button key={n} type="button" className="rounded-full border border-slate-300 bg-white px-3 py-2 text-sm" onClick={() => add(n)}>
                {label(n)}
              </button>
            ))}
            <button type="button" className="rounded-full border border-slate-300 bg-white px-3 py-2 text-sm" onClick={() => setOther('')}>
              {t('ob.lang.Other')}
            </button>
          </div>
          {other !== null && (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(other); }}>
              <input className="input" autoFocus maxLength={40} value={other} placeholder={t('ob.lang.otherPlaceholder')}
                aria-label={t('ob.lang.otherPlaceholder')} onChange={(e) => setOther(e.target.value)} />
              <button className="btn-secondary shrink-0" type="submit">{t('common.add')}</button>
            </form>
          )}
          <button type="button" className="text-sm text-slate-500 underline" onClick={() => { setPicking(false); setOther(null); }}>
            {t('ob.lang.close')}
          </button>
        </div>
      )}
    </section>
  );
}

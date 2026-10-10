import en from './en.json';
import ta from './ta.json';

export type Lang = 'en' | 'ta';
export type Dict = Record<string, string>;
export const dictionaries: Record<Lang, Dict> = { en, ta };

/** Lookup with English fallback and {placeholder} interpolation. */
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let s = dictionaries[lang]?.[key] ?? dictionaries.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

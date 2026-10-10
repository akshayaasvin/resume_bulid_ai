import 'server-only';
import { cookies } from 'next/headers';
import { translate, type Lang } from './index';

export function getLang(): Lang {
  return cookies().get('lang')?.value === 'ta' ? 'ta' : 'en';
}

export function getT() {
  const lang = getLang();
  return { lang, t: (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars) };
}

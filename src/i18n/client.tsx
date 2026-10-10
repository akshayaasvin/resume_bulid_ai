'use client';
import { createContext, useCallback, useContext } from 'react';
import { translate, type Lang } from './index';

const LangContext = createContext<Lang>('en');

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useT() {
  const lang = useContext(LangContext);
  const t = useCallback((key: string, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
  return { lang, t };
}

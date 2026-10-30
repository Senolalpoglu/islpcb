import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { en } from './en';
import { tr } from './tr';

export type Lang = 'tr' | 'en';
export type Key = keyof typeof en;

const DICTS: Record<Lang, Record<Key, string>> = { en, tr };

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: Key, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18n>({ lang: 'tr', setLang: () => {}, t: (k) => k });

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('snl.lang');
    if (saved === 'tr' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  return navigator.language.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  // Keeps CSS text-transform (uppercase headings) correct: Turkish dotted İ only for Turkish.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem('snl.lang', l);
    } catch {
      /* storage unavailable */
    }
  };
  const t: I18n['t'] = (key, vars) => {
    let s = DICTS[lang][key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
    return s;
  };
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export const useI18n = (): I18n => useContext(Ctx);

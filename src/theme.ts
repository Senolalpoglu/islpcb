// Colour themes. Each theme is a set of CSS variables in styles.css, selected by the `data-theme` attribute.

import type { Key } from './i18n';

export interface Theme {
  id: string;
  label: Key;
}

export const THEMES: Theme[] = [
  { id: 'dark', label: 'theme.dark' },
  { id: 'light', label: 'theme.light' },
  { id: 'paper', label: 'theme.paper' },
  { id: 'linen', label: 'theme.linen' },
  { id: 'stone', label: 'theme.stone' },
  { id: 'sand', label: 'theme.sand' },
  { id: 'mist', label: 'theme.mist' },
  { id: 'blender', label: 'theme.blender' },
  { id: 'fusion', label: 'theme.fusion' },
  { id: 'midnight', label: 'theme.midnight' },
  { id: 'forest', label: 'theme.forest' },
  { id: 'sunset', label: 'theme.sunset' },
  { id: 'contrast', label: 'theme.contrast' },
];

const STORAGE_KEY = 'snl.theme';

export function loadTheme(): string {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    if (id && THEMES.some((t) => t.id === id)) return id;
  } catch {
    /* storage unavailable: use the default */
  }
  return 'paper';
}

/** The themes drawn as paper: white cards with a heavy outline on a tinted window (the rules in styles.css hang on data-style). */
const PAPER_FAMILY = ['paper', 'linen', 'stone', 'sand', 'mist'];

export function applyTheme(id: string): void {
  document.documentElement.setAttribute('data-theme', id);
  if (PAPER_FAMILY.includes(id)) document.documentElement.setAttribute('data-style', 'paper');
  else document.documentElement.removeAttribute('data-style');
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* the choice only lasts for this session */
  }
}

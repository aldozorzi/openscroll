export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_KEY = 'openscroll-theme';

export function getThemeMode(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'system';
  }
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system'
    ? stored
    : 'system';
}

export function resolveDark(mode: ThemeMode): boolean {
  if (mode === 'dark') {
    return true;
  }
  if (mode === 'light') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(mode: ThemeMode): void {
  window.localStorage.setItem(THEME_KEY, mode);
  document.documentElement.classList.toggle('dark', resolveDark(mode));
}

export function toggleTheme(): ThemeMode {
  const next = resolveDark(getThemeMode()) ? 'light' : 'dark';
  applyTheme(next);
  return next;
}

'use client';

import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from './icons';
import { useLocale } from './providers';
import { getThemeMode, resolveDark, toggleTheme, type ThemeMode } from '../lib/theme';

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { t } = useLocale();
  const [mode, setMode] = useState<ThemeMode>('system');
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const current = getThemeMode();
    setMode(current);
    setDark(resolveDark(current));
  }, []);

  const toggle = () => {
    const next = toggleTheme();
    setMode(next);
    setDark(resolveDark(next));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t('themeToggle')}
      title={t('themeToggle')}
      className={[
        'focus-ring inline-flex items-center justify-center rounded-full border border-line bg-surface/80 text-muted transition hover:border-accent/50 hover:text-ink',
        compact ? 'h-9 w-9' : 'h-10 w-10',
      ].join(' ')}
      data-theme={mode}
    >
      {dark ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
    </button>
  );
}

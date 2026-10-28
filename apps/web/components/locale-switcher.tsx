'use client';

import { useLocale } from './providers';
import { LOCALES, type Locale } from '../lib/i18n';

export function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useLocale();

  return (
    <label className={compact ? 'sr-only' : 'flex items-center gap-2 text-sm'}>
      {!compact && <span className="text-muted">{t('language')}</span>}
      <select
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
        aria-label={t('languageSelect')}
        className="focus-ring rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-ink"
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {code === 'en' ? t('english') : t('italian')}
          </option>
        ))}
      </select>
    </label>
  );
}

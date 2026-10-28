'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../lib/api-client';
import { SOURCE_URL } from '../lib/constants';
import { CONTENT_LANGUAGES, TOPIC_SUGGESTIONS } from '../lib/i18n';
import { applyTheme, getThemeMode, type ThemeMode } from '../lib/theme';
import { cn, formatDate } from '../lib/utils';
import {
  CodeIcon,
  DownloadIcon,
  PlusIcon,
  SettingsIcon,
  SyncIcon,
  TrashIcon,
} from './icons';
import { LocaleSwitcher } from './locale-switcher';
import { PageHeading } from './page-heading';
import { useAuth, useLocale, useOffline, useToast } from './providers';

function TagEditor({
  label,
  hint,
  values,
  suggestions,
  onChange,
}: {
  label: string;
  hint: string;
  values: string[];
  suggestions?: readonly string[];
  onChange: (values: string[]) => void;
}) {
  const { t } = useLocale();
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const value = raw.trim();
    if (!value || values.some((item) => item.toLowerCase() === value.toLowerCase())) {
      return;
    }
    onChange([...values, value]);
    setDraft('');
  };

  return (
    <div>
      <div className="flex items-end justify-between gap-2">
        <label htmlFor={`tags-${label}`} className="text-xs font-bold uppercase tracking-wider text-muted">
          {label}
        </label>
        <span className="text-[0.68rem] text-muted">{t('optional')}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-muted">{hint}</p>

      {values.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {values.map((value) => (
            <span key={value} className="chip chip-active">
              {value}
              <button
                type="button"
                onClick={() => onChange(values.filter((item) => item !== value))}
                aria-label={`${t('remove')} ${value}`}
                className="focus-ring ms-1 rounded-full text-current/70 hover:text-current"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <input
          id={`tags-${label}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add(draft);
            }
          }}
          className="field"
          placeholder={t('customTopic')}
        />
        <button
          type="button"
          onClick={() => add(draft)}
          className="btn btn-secondary shrink-0"
        >
          <PlusIcon className="h-4 w-4" />
          {t('addTopic')}
        </button>
      </div>

      {suggestions && suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {suggestions.slice(0, 8).map((suggestion) => {
            const selected = values.some(
              (value) => value.toLowerCase() === suggestion.toLowerCase(),
            );
            return (
              <button
                key={suggestion}
                type="button"
                onClick={() =>
                  selected
                    ? onChange(
                        values.filter(
                          (value) => value.toLowerCase() !== suggestion.toLowerCase(),
                        ),
                      )
                    : add(suggestion)
                }
                aria-pressed={selected}
                className={cn('chip', selected && 'chip-active')}
              >
                {selected ? '−' : '+'} {suggestion}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SettingsView() {
  const router = useRouter();
  const { user, refresh, signOut } = useAuth();
  const { t, locale } = useLocale();
  const { toast } = useToast();
  const { online, pending, flush } = useOffline();
  const [topics, setTopics] = useState<string[]>([]);
  const [excludedTopics, setExcludedTopics] = useState<string[]>([]);
  const [language, setLanguage] = useState('');
  const [theme, setTheme] = useState<ThemeMode>('system');
  const [saving, setSaving] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!user) {
      return;
    }
    setTopics(user.preferences?.topics ?? []);
    setExcludedTopics(user.preferences?.excludedTopics ?? []);
    setLanguage(user.preferences?.language ?? '');
  }, [user]);

  useEffect(() => {
    setTheme(getThemeMode());
  }, []);

  const savePreferences = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api('/api/v1/user/preferences', {
        method: 'PUT',
        body: {
          topics,
          excludedTopics,
          ...(language ? { language } : {}),
        },
      });
      await refresh();
      toast(t('preferencesSaved'), 'success');
    } catch (caught) {
      toast(
        caught instanceof ApiError && caught.status === 429
          ? t('errorRateLimited')
          : t('errorGeneric'),
        'error',
      );
    } finally {
      setSaving(false);
    }
  };

  const changeTheme = (next: ThemeMode) => {
    setTheme(next);
    applyTheme(next);
  };

  const deleteAccount = async () => {
    if (deleteConfirmation !== 'DELETE') {
      return;
    }
    setDeleting(true);
    try {
      await api('/api/v1/me', { method: 'DELETE' });
      toast(t('accountDeleted'), 'success');
      await signOut();
      router.replace('/register');
    } catch {
      toast(t('errorGeneric'), 'error');
      setDeleting(false);
    }
  };

  if (!user) {
    return null;
  }

  return (
    <div className="flex flex-col pb-8">
      <PageHeading
        eyebrow={t('appName')}
        titleKey="settingsTitle"
        subtitleKey="settingsSubtitle"
        icon={SettingsIcon}
      />

      <div className="grid gap-4 px-4 sm:px-6 lg:grid-cols-2 lg:px-10">
        <section className="surface-panel rounded-3xl p-5 sm:p-6">
          <h2 className="font-display text-xl font-semibold">{t('profileTitle')}</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted">{t('emailLabel')}</dt>
              <dd className="truncate font-semibold text-ink">{user.email}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted">{t('roleLabel')}</dt>
              <dd className="font-semibold capitalize text-ink">{user.role}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted">{t('memberSinceLabel')}</dt>
              <dd className="font-semibold text-ink">
                {formatDate(user.created_at, locale)}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={async () => {
              await signOut();
              router.replace('/login');
            }}
            className="btn btn-secondary mt-5"
          >
            {t('signOut')}
          </button>
        </section>

        <section className="surface-panel rounded-3xl p-5 sm:p-6">
          <h2 className="font-display text-xl font-semibold">{t('appearanceTitle')}</h2>
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="theme-select" className="text-sm font-medium text-ink">
                {t('themeLabel')}
              </label>
              <select
                id="theme-select"
                value={theme}
                onChange={(event) => changeTheme(event.target.value as ThemeMode)}
                className="field max-w-40"
              >
                <option value="system">{t('system')}</option>
                <option value="light">{t('light')}</option>
                <option value="dark">{t('dark')}</option>
              </select>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-ink">{t('uiLanguageLabel')}</span>
              <LocaleSwitcher compact />
            </div>
            <div className="rounded-2xl border border-line bg-elevated/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted">
                    {t('offlineTitle')}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-ink">
                    {t('pendingCount', { count: pending })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void flush().catch(() => undefined)}
                  disabled={!online || pending === 0}
                  className="btn btn-secondary px-3 py-1.5 text-xs"
                >
                  <SyncIcon className="h-3.5 w-3.5" />
                  {t('syncNow')}
                </button>
              </div>
            </div>
          </div>
        </section>

        <form
          onSubmit={savePreferences}
          className="surface-panel rounded-3xl p-5 sm:p-6 lg:col-span-2"
        >
          <h2 className="font-display text-xl font-semibold">
            {t('preferencesTitle')}
          </h2>
          <div className="mt-5 grid gap-6 lg:grid-cols-2">
            <TagEditor
              label={t('topicsLabel')}
              hint={t('topicsHint')}
              values={topics}
              suggestions={TOPIC_SUGGESTIONS}
              onChange={setTopics}
            />
            <TagEditor
              label={t('excludedLabel')}
              hint={t('excludedHint')}
              values={excludedTopics}
              onChange={setExcludedTopics}
            />
          </div>

          <div className="mt-6 max-w-sm">
            <label
              htmlFor="content-language"
              className="text-xs font-bold uppercase tracking-wider text-muted"
            >
              {t('contentLanguageLabel')}
            </label>
            <select
              id="content-language"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              className="field mt-2"
            >
              <option value="">{t('anyLanguage')}</option>
              {CONTENT_LANGUAGES.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <button type="submit" disabled={saving} className="btn btn-primary mt-6">
            {saving ? t('savingPreferences') : t('savePreferences')}
          </button>
        </form>

        <section className="surface-panel rounded-3xl p-5 sm:p-6">
          <h2 className="font-display text-xl font-semibold">{t('dataTitle')}</h2>
          <p className="mt-2 text-xs leading-5 text-muted">{t('dataHint')}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href="/api/v1/me/export"
              className="btn btn-secondary"
              download
              onClick={() => toast(t('exportStarted'))}
            >
              <DownloadIcon className="h-4 w-4" />
              {t('exportData')}
            </a>
            <a
              href={SOURCE_URL}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost"
            >
              <CodeIcon className="h-4 w-4" />
              {t('sourceCode')}
            </a>
          </div>
        </section>

        <section className="rounded-3xl border border-danger/30 bg-danger/5 p-5 sm:p-6">
          <h2 className="font-display text-xl font-semibold text-danger">
            {t('deleteAccount')}
          </h2>
          <p className="mt-2 text-xs leading-5 text-muted">{t('deleteAccountHint')}</p>
          <label
            htmlFor="delete-confirmation"
            className="mt-4 block text-xs font-semibold text-ink"
          >
            {t('deleteConfirm')}
          </label>
          <input
            id="delete-confirmation"
            value={deleteConfirmation}
            onChange={(event) => setDeleteConfirmation(event.target.value)}
            className="field mt-2 max-w-xs"
            autoComplete="off"
            placeholder="DELETE"
          />
          <button
            type="button"
            onClick={() => void deleteAccount()}
            disabled={deleteConfirmation !== 'DELETE' || deleting}
            className="btn btn-danger mt-3"
          >
            <TrashIcon className="h-4 w-4" />
            {deleting ? t('deletingAccount') : t('deleteAccountAction')}
          </button>
        </section>
      </div>
    </div>
  );
}

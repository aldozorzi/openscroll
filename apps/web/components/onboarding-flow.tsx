'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api-client';
import {
  CONTENT_LANGUAGES,
  TOPIC_SUGGESTIONS,
  type TranslationKey,
} from '../lib/i18n';
import { cn } from '../lib/utils';
import { CheckIcon, PlusIcon, SparkIcon } from './icons';
import { useAuth, useLocale, useToast } from './providers';
import { SourceAddForm } from './source-add-form';

const steps: Array<{
  title: TranslationKey;
  hint: TranslationKey;
}> = [
  { title: 'topicsTitle', hint: 'topicsHint' },
  { title: 'excludedTitle', hint: 'excludedHint' },
  { title: 'onboardingSourcesTitle', hint: 'onboardingSourcesHint' },
];

export function OnboardingFlow() {
  const router = useRouter();
  const { user, refresh } = useAuth();
  const { t } = useLocale();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [topics, setTopics] = useState<string[]>([]);
  const [excludedTopics, setExcludedTopics] = useState<string[]>([]);
  const [language, setLanguage] = useState('');
  const [topicDraft, setTopicDraft] = useState('');
  const [excludedDraft, setExcludedDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user?.preferences) {
      return;
    }
    setTopics(user.preferences.topics);
    setExcludedTopics(user.preferences.excludedTopics);
    setLanguage(user.preferences.language ?? '');
  }, [user]);

  const addTopic = (raw: string) => {
    const value = raw.trim();
    if (!value || topics.some((item) => item.toLowerCase() === value.toLowerCase())) {
      return;
    }
    const suggestion = TOPIC_SUGGESTIONS.find(
      (topic) => topic.toLowerCase() === value.toLowerCase(),
    );
    setTopics((current) => [...current, suggestion ?? value]);
    setTopicDraft('');
  };

  const addExcluded = (raw: string) => {
    const value = raw.trim();
    if (
      !value ||
      excludedTopics.some((item) => item.toLowerCase() === value.toLowerCase())
    ) {
      return;
    }
    setExcludedTopics((current) => [...current, value]);
    setExcludedDraft('');
  };

  const next = () => {
    setError(null);
    if (step === 0 && topics.length === 0) {
      setError(t('chooseTopic'));
      return;
    }
    setStep((current) => Math.min(current + 1, steps.length - 1));
  };

  const finish = async () => {
    setSaving(true);
    setError(null);
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
      toast(t('done'), 'success');
      router.replace('/feed');
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 429
          ? t('errorRateLimited')
          : t('errorGeneric'),
      );
    } finally {
      setSaving(false);
    }
  };

  const skip = () => {
    router.replace('/feed');
  };

  const current = steps[step]!;
  const customTopics = topics.filter(
    (topic) =>
      !TOPIC_SUGGESTIONS.some(
        (suggestion) => suggestion.toLowerCase() === topic.toLowerCase(),
      ),
  );

  return (
    <div className="px-4 py-5 sm:px-6 sm:py-8">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent/15 text-accent">
            <SparkIcon className="h-4 w-4" />
          </span>
          {t('step', { current: step + 1, total: steps.length })}
        </div>
        <button
          type="button"
          onClick={skip}
          className="focus-ring rounded-full px-3 py-1.5 text-xs font-semibold text-muted hover:bg-ink/5 hover:text-ink"
        >
          {t('skip')}
        </button>
      </div>

      <div
        className="mt-5 h-1.5 overflow-hidden rounded-full bg-ink/8"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={step + 1}
        aria-label={t('step', { current: step + 1, total: steps.length })}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${((step + 1) / steps.length) * 100}%` }}
        />
      </div>

      <section className="surface-panel mt-5 rounded-[1.8rem] p-5 sm:p-7">
        <p className="text-[0.68rem] font-bold uppercase tracking-[0.2em] text-accent">
          {t('onboardingTitle')}
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {t(current.title)}
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted">{t(current.hint)}</p>

        <div className="mt-6">
          {step === 0 && (
            <div>
              <div className="flex flex-wrap gap-2">
                {TOPIC_SUGGESTIONS.map((topic) => {
                  const selected = topics.some(
                    (item) => item.toLowerCase() === topic.toLowerCase(),
                  );
                  return (
                    <button
                      key={topic}
                      type="button"
                      onClick={() =>
                        setTopics((currentTopics) =>
                          selected
                            ? currentTopics.filter(
                                (item) =>
                                  item.toLowerCase() !== topic.toLowerCase(),
                              )
                            : [...currentTopics, topic],
                        )
                      }
                      aria-pressed={selected}
                      className={cn(
                        'focus-ring inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition',
                        selected
                          ? 'border-accent/50 bg-accent/15 text-accent'
                          : 'border-line bg-surface/70 text-muted hover:border-accent/35 hover:text-ink',
                      )}
                    >
                      {selected && <CheckIcon className="h-3.5 w-3.5" />}
                      {topic}
                    </button>
                  );
                })}
              </div>

              {customTopics.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {customTopics.map((topic) => (
                    <span key={topic} className="chip chip-active">
                      {topic}
                      <button
                        type="button"
                        onClick={() =>
                          setTopics((current) =>
                            current.filter((item) => item !== topic),
                          )
                        }
                        aria-label={`${t('remove')} ${topic}`}
                        className="focus-ring ms-1 rounded-full"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-5 flex max-w-md gap-2">
                <input
                  value={topicDraft}
                  onChange={(event) => setTopicDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addTopic(topicDraft);
                    }
                  }}
                  className="field"
                  placeholder={t('customTopic')}
                  aria-label={t('customTopic')}
                />
                <button
                  type="button"
                  onClick={() => addTopic(topicDraft)}
                  className="btn btn-secondary shrink-0"
                >
                  <PlusIcon className="h-4 w-4" />
                  {t('addTopic')}
                </button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <div>
                <div className="flex max-w-md gap-2">
                  <input
                    value={excludedDraft}
                    onChange={(event) => setExcludedDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addExcluded(excludedDraft);
                      }
                    }}
                    className="field"
                    placeholder={t('customTopic')}
                    aria-label={t('excludedLabel')}
                  />
                  <button
                    type="button"
                    onClick={() => addExcluded(excludedDraft)}
                    className="btn btn-secondary shrink-0"
                  >
                    <PlusIcon className="h-4 w-4" />
                    {t('addTopic')}
                  </button>
                </div>
                {excludedTopics.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {excludedTopics.map((topic) => (
                      <span key={topic} className="chip chip-active">
                        {topic}
                        <button
                          type="button"
                          onClick={() =>
                            setExcludedTopics((current) =>
                              current.filter((item) => item !== topic),
                            )
                          }
                          aria-label={`${t('remove')} ${topic}`}
                          className="focus-ring ms-1 rounded-full"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="max-w-sm">
                <label
                  htmlFor="onboarding-language"
                  className="text-xs font-bold uppercase tracking-wider text-muted"
                >
                  {t('languageTitle')}
                </label>
                <p className="mt-1 text-xs text-muted">{t('languageHint')}</p>
                <select
                  id="onboarding-language"
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
            </div>
          )}

          {step === 2 && (
            <SourceAddForm compact />
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setStep((current) => Math.max(0, current - 1))}
            disabled={step === 0}
            className="btn btn-secondary"
          >
            {t('back')}
          </button>

          <div className="flex items-center gap-2">
            {step < steps.length - 1 ? (
              <button type="button" onClick={next} className="btn btn-primary">
                {t('continue')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void finish()}
                disabled={saving}
                className="btn btn-primary"
              >
                {saving ? t('savingPreferences') : t('finish')}
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

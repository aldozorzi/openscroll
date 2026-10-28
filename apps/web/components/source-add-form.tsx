'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '../lib/api-client';
import type { SourceSummary } from '../lib/types';
import { PlusIcon, UploadIcon } from './icons';
import { useLocale, useToast } from './providers';

const OPML_MAX_BYTES = 1_000_000;

export function SourceAddForm({
  onAdded,
  onImported,
  compact = false,
}: {
  onAdded?: (source: SourceSummary) => void;
  onImported?: (sources: SourceSummary[]) => void;
  compact?: boolean;
}) {
  const { t } = useLocale();
  const { toast } = useToast();
  const fieldId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);

  const addSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const data = await api<{ source: SourceSummary }>('/api/v1/sources', {
        method: 'POST',
        body: {
          url: url.trim(),
          ...(title.trim() ? { title: title.trim() } : {}),
        },
        timeoutMs: 45_000,
      });
      setUrl('');
      setTitle('');
      toast(t('sourceAdded'), 'success');
      onAdded?.(data.source);
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.status === 429) {
          setError(t('errorRateLimited'));
        } else if (caught.status === 400) {
          setError(t('sourceAddError'));
        } else {
          setError(caught.message || t('errorGeneric'));
        }
      } else {
        setError(t('errorGeneric'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const importOpml = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    setError(null);
    if (file.size > OPML_MAX_BYTES) {
      setError(t('importHint'));
      return;
    }
    setImporting(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const data = await api<{ imported: number; sources: SourceSummary[] }>(
        '/api/v1/sources/import/opml',
        { method: 'POST', body: form, timeoutMs: 60_000 },
      );
      toast(t('opmlImported', { count: data.imported }), 'success');
      onImported?.(data.sources);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 429
          ? t('errorRateLimited')
          : t('opmlInvalid'),
      );
    } finally {
      setImporting(false);
      if (fileRef.current) {
        fileRef.current.value = '';
      }
    }
  };

  return (
    <section
      className={
        compact
          ? ''
          : 'surface-panel rounded-3xl p-5 sm:p-6'
      }
      aria-labelledby={`${fieldId}-heading`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id={`${fieldId}-heading`}
            className="font-display text-xl font-semibold text-ink"
          >
            {t('addSourceTitle')}
          </h2>
          <p className="mt-1 max-w-lg text-xs leading-5 text-muted">
            {t('addSourceHint')}
          </p>
        </div>
        <span className="chip">{t('sourceOptional')}</span>
      </div>

      <form onSubmit={addSource} className="mt-4 grid gap-2.5 sm:grid-cols-[1fr_auto]">
        <div className="grid gap-2.5 sm:col-span-2 sm:grid-cols-[1.4fr_1fr]">
          <label htmlFor={`${fieldId}-url`} className="sr-only">
            {t('sourceUrlLabel')}
          </label>
          <input
            id={`${fieldId}-url`}
            type="url"
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="field"
            placeholder="https://example.com/feed.xml"
            autoComplete="url"
          />
          <label htmlFor={`${fieldId}-title`} className="sr-only">
            {t('sourceTitleLabel')}
          </label>
          <input
            id={`${fieldId}-title`}
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="field"
            placeholder={t('sourceTitleLabel')}
          />
        </div>
        <button type="submit" disabled={submitting} className="btn btn-primary justify-self-start">
          <PlusIcon className="h-4 w-4" />
          {submitting ? t('addingSource') : t('addSource')}
        </button>
        <div className="flex items-center gap-2 justify-self-start sm:justify-self-end">
          <input
            ref={fileRef}
            type="file"
            accept=".opml,.xml,text/xml,application/xml"
            className="sr-only"
            onChange={(event) => void importOpml(event.target.files?.[0])}
            aria-label={t('uploadOpml')}
          />
          <button
            type="button"
            disabled={importing}
            onClick={() => fileRef.current?.click()}
            className="focus-ring inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold text-muted transition hover:bg-ink/5 hover:text-ink"
          >
            <UploadIcon className="h-4 w-4" />
            {importing ? t('importing') : t('uploadOpml')}
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api-client';
import { cn } from '../lib/utils';
import {
  AlertIcon,
  CheckIcon,
  ClockIcon,
  ErrorIcon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  SearchIcon,
  ShieldIcon,
  SkipIcon,
  SyncIcon,
  TrashIcon,
  WarningIcon,
} from './icons';
import { PageHeading } from './page-heading';
import { useAuth, useLocale, useToast } from './providers';

const TOKEN_KEY = 'openscroll-admin-token';

// ─── Shared types ───────────────────────────────────────────────────────────

interface UsageResponse {
  date: string;
  limits: {
    max_llm_tokens_per_day: number;
    max_embedding_tokens_per_day: number;
  };
  totals: {
    llm_tokens: number;
    embedding_tokens: number;
    articles: number;
  };
  usage: Array<{ provider: string; metric: string; value: number; updated_at: string }>;
}

interface QueueResponse {
  driver: string;
  pending: number;
  queues: Array<{
    name: string;
    queued: number;
    active: number;
    completed: number;
    failed: number;
  }>;
}

interface ArticleItem {
  id: string;
  sourceId: string | null;
  title: string;
  originalUrl: string;
  canonicalUrl: string;
  status: string;
  attempts: number;
  lastError: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  retentionExpiresAt: string | null;
  hasRawContent: boolean;
  hasCleanedContent: boolean;
  contentHash: string | null;
}

interface ArticlesResponse {
  items: ArticleItem[];
  total: number;
  limit: number;
  offset: number;
}

interface CardItem {
  id: string;
  articleId: string;
  hook: string;
  coreConcept: string;
  keyTakeaways: string[];
  estimatedReadTimeSec: number;
  embeddingModel: string | null;
  embeddingDim: number | null;
  topicTags: string[];
  language: string | null;
  generationModel: string | null;
  promptVersion: string | null;
  status: string;
  hasEmbedding: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CardsResponse {
  items: CardItem[];
  total: number;
  limit: number;
  offset: number;
}

interface SourceItem {
  id: string;
  title: string;
  url: string;
  sourceType: string;
  category: string | null;
  isPublic: boolean;
  isActive: boolean;
  etag: string | null;
  lastModified: string | null;
  fetchIntervalMinutes: number;
  nextFetchAt: string | null;
  lastFetchedAt: string | null;
  consecutiveFailures: number;
  lastFailureAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  articlesCount: number;
}

interface SourcesResponse {
  items: SourceItem[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function percent(value: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((value / limit) * 100));
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function truncate(str: string, max = 80): string {
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

// ─── Status badge ───────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-500/20 text-amber-400',
  fetching: 'bg-blue-500/20 text-blue-400',
  processing: 'bg-blue-500/20 text-blue-400',
  ready: 'bg-green-500/20 text-green-400',
  skipped: 'bg-gray-500/20 text-gray-400',
  failed: 'bg-red-500/20 text-red-400',
  published: 'bg-green-500/20 text-green-400',
  hidden: 'bg-gray-500/20 text-gray-400',
  archived: 'bg-gray-500/20 text-gray-400',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[0.7rem] font-medium', STATUS_COLORS[status] || 'bg-gray-500/20 text-gray-400')}>
      {status}
    </span>
  );
}

// ─── Meter (reused from original) ───────────────────────────────────────────

function Meter({ label, value, limit, remainingLabel }: { label: string; value: number; limit: number; remainingLabel: string }) {
  const ratio = percent(value, limit);
  return (
    <div className="rounded-2xl border border-line bg-elevated/50 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-wider text-muted">{label}</p>
        <p className="text-xs font-semibold text-muted">{remainingLabel}</p>
      </div>
      <p className="mt-2 font-display text-2xl font-semibold text-ink">
        {value.toLocaleString()}
        <span className="text-sm font-medium text-muted"> / {limit.toLocaleString()}</span>
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink/10" role="progressbar" aria-valuenow={ratio} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn('h-full rounded-full transition-[width]', ratio >= 90 ? 'bg-danger' : ratio >= 70 ? 'bg-amber-500' : 'bg-accent')} style={{ width: `${ratio}%` }} />
      </div>
    </div>
  );
}

// ─── Tab definitions ────────────────────────────────────────────────────────

type TabId = 'overview' | 'articles' | 'cards' | 'sources';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'articles', label: 'Articles' },
  { id: 'cards', label: 'Cards' },
  { id: 'sources', label: 'Sources' },
];

// ─── Main component ─────────────────────────────────────────────────────────

export function AdminView() {
  const { user } = useAuth();
  const { t } = useLocale();
  const { toast } = useToast();
  const [token, setToken] = useState('');
  const [draftToken, setDraftToken] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');
  const [articleId, setArticleId] = useState('');
  const [reason, setReason] = useState('');

  // Data
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [articles, setArticles] = useState<ArticlesResponse | null>(null);
  const [cards, setCards] = useState<CardsResponse | null>(null);
  const [sources, setSources] = useState<SourcesResponse | null>(null);

  // Filters
  const [articleStatus, setArticleStatus] = useState('');
  const [articleSearch, setArticleSearch] = useState('');
  const [cardStatus, setCardStatus] = useState('');
  const [cardSearch, setCardSearch] = useState('');
  const [sourceActive, setSourceActive] = useState('');
  const [sourceSearch, setSourceSearch] = useState('');

  useEffect(() => {
    const stored = sessionStorage.getItem(TOKEN_KEY);
    if (stored) { setToken(stored); setDraftToken(stored); }
  }, []);

  const headers = useCallback(() => ({ 'x-admin-token': token }), [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const [nextUsage, nextQueue] = await Promise.all([
        api<UsageResponse>('/api/v1/admin/usage', { headers: headers() }),
        api<QueueResponse>('/api/v1/admin/queue', { headers: headers() }),
      ]);
      setUsage(nextUsage);
      setQueue(nextQueue);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setError(t('adminInvalidToken'));
        setUsage(null); setQueue(null);
      } else {
        setError(caught instanceof Error ? caught.message : t('errorGeneric'));
      }
    } finally { setLoading(false); }
  }, [headers, t, token]);

  useEffect(() => { if (token) void load(); }, [load, token]);

  const loadArticles = useCallback(async () => {
    if (!token) return;
    const params = new URLSearchParams();
    if (articleStatus) params.set('status', articleStatus);
    if (articleSearch) params.set('search', articleSearch);
    params.set('limit', '100');
    try {
      const res = await api<ArticlesResponse>(`/api/v1/admin/articles?${params}`, { headers: headers() });
      setArticles(res);
    } catch { /* ignore */ }
  }, [token, articleStatus, articleSearch, headers]);

  const loadCards = useCallback(async () => {
    if (!token) return;
    const params = new URLSearchParams();
    if (cardStatus) params.set('status', cardStatus);
    if (cardSearch) params.set('search', cardSearch);
    params.set('limit', '100');
    try {
      const res = await api<CardsResponse>(`/api/v1/admin/cards?${params}`, { headers: headers() });
      setCards(res);
    } catch { /* ignore */ }
  }, [token, cardStatus, cardSearch, headers]);

  const loadSources = useCallback(async () => {
    if (!token) return;
    const params = new URLSearchParams();
    if (sourceActive) params.set('is_active', sourceActive);
    if (sourceSearch) params.set('search', sourceSearch);
    params.set('limit', '200');
    try {
      const res = await api<SourcesResponse>(`/api/v1/admin/sources?${params}`, { headers: headers() });
      setSources(res);
    } catch { /* ignore */ }
  }, [token, sourceActive, sourceSearch, headers]);

  // Load tab data when tab changes
  useEffect(() => {
    if (!token) return;
    if (activeTab === 'articles') void loadArticles();
    if (activeTab === 'cards') void loadCards();
    if (activeTab === 'sources') void loadSources();
  }, [activeTab, token, loadArticles, loadCards, loadSources]);

  if (user?.role !== 'admin') {
    return (
      <div className="flex flex-col pb-8">
        <PageHeading eyebrow={t('appName')} titleKey="adminTitle" subtitleKey="adminSubtitle" icon={ShieldIcon} />
        <p className="mx-4 rounded-3xl border border-line bg-surface p-5 text-sm text-muted sm:mx-6 lg:mx-10">{t('adminForbidden')}</p>
      </div>
    );
  }

  const unlock = () => {
    const next = draftToken.trim();
    setToken(next);
    if (next) sessionStorage.setItem(TOKEN_KEY, next);
    else sessionStorage.removeItem(TOKEN_KEY);
  };

  const forget = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(''); setDraftToken('');
    setUsage(null); setQueue(null); setError('');
  };

  const runAction = async (path: string, body: Record<string, unknown>, successMsg: string) => {
    setActing(true);
    try {
      await api(path, { method: 'POST', headers: headers(), body });
      toast(successMsg, 'success');
      await load();
      void loadArticles(); void loadCards(); void loadSources();
    } catch (caught) {
      toast(caught instanceof ApiError && caught.status === 401 ? t('adminInvalidToken') : t('errorGeneric'), 'error');
    } finally { setActing(false); }
  };

  const articleAction = async (articleId: string, action: string) => {
    setActing(true);
    try {
      await api('/api/v1/admin/articles', { method: 'POST', headers: headers(), body: { article_id: articleId, action } });
      toast(`Article ${action}ed`, 'success');
      void loadArticles(); void load();
    } catch { toast('Action failed', 'error'); }
    finally { setActing(false); }
  };

  const cardAction = async (cardId: string, action: string) => {
    setActing(true);
    try {
      await api('/api/v1/admin/cards', { method: 'POST', headers: headers(), body: { card_id: cardId, action } });
      toast(`Card ${action}ed`, 'success');
      void loadCards(); void load();
    } catch { toast('Action failed', 'error'); }
    finally { setActing(false); }
  };

  const sourceAction = async (sourceId: string, action: string, interval?: number) => {
    setActing(true);
    try {
      const body: Record<string, unknown> = { source_id: sourceId, action };
      if (interval) body.fetch_interval_minutes = interval;
      await api('/api/v1/admin/sources', { method: 'POST', headers: headers(), body });
      toast(`Source ${action.replace('_', ' ')}ed`, 'success');
      void loadSources(); void load();
    } catch { toast('Action failed', 'error'); }
    finally { setActing(false); }
  };

  // ─── Tab content renderers ──────────────────────────────────────────────

  const renderOverview = () => (
    <>
      {usage && (
        <section className="surface-panel rounded-3xl p-5 sm:p-6">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold">{t('adminUsageTitle')}</h2>
              <p className="mt-1 text-xs text-muted">{t('adminUsageHint')}</p>
            </div>
            <span className="text-xs font-semibold text-muted">{usage.date}</span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Meter label="LLM Tokens" value={usage.totals.llm_tokens} limit={usage.limits.max_llm_tokens_per_day} remainingLabel={`${Math.max(0, usage.limits.max_llm_tokens_per_day - usage.totals.llm_tokens).toLocaleString()} remaining`} />
            <Meter label="Embedding Tokens" value={usage.totals.embedding_tokens} limit={usage.limits.max_embedding_tokens_per_day} remainingLabel={`${Math.max(0, usage.limits.max_embedding_tokens_per_day - usage.totals.embedding_tokens).toLocaleString()} remaining`} />
          </div>
          {usage.usage.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted">
                  <tr><th className="py-2 pe-4 font-semibold">Provider</th><th className="py-2 pe-4 font-semibold">Metric</th><th className="py-2 font-semibold">Value</th></tr>
                </thead>
                <tbody>
                  {usage.usage.map((row) => (
                    <tr key={`${row.provider}:${row.metric}`} className="border-t border-line/60">
                      <td className="py-2 pe-4 font-semibold text-ink">{row.provider}</td>
                      <td className="py-2 pe-4 text-muted">{row.metric}</td>
                      <td className="py-2 font-mono text-xs text-ink">{row.value.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {queue && (
        <section className="surface-panel rounded-3xl p-5 sm:p-6">
          <h2 className="font-display text-xl font-semibold">Queue Status</h2>
          <p className="mt-1 text-xs text-muted">Driver: <span className="font-mono text-ink">{queue.driver}</span> · {queue.pending} pending jobs</p>
          {queue.queues.length === 0 ? (
            <p className="mt-4 text-sm text-muted">All queues empty</p>
          ) : (
            <div className="mt-4 space-y-2">
              {queue.queues.map((item) => (
                <div key={item.name} className="rounded-2xl border border-line bg-elevated/40 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-xs font-semibold text-ink">{item.name}</p>
                    <p className="text-xs text-muted">{item.queued} queued · {item.active} active</p>
                  </div>
                  <div className="mt-1 flex gap-3 text-[0.7rem] text-muted">
                    <span>Completed: {item.completed}</span>
                    <span className={item.failed > 0 ? 'font-semibold text-danger' : ''}>Failed: {item.failed}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Pipeline status summary */}
      <section className="surface-panel rounded-3xl p-5 sm:p-6">
        <h2 className="font-display text-xl font-semibold">Pipeline Health</h2>
        <p className="mt-1 text-xs text-muted">Quick actions to unblock the pipeline</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <button type="button" disabled={!token || acting} onClick={() => void runAction('/api/v1/admin/ingest', {}, 'All sources ingested')} className="btn btn-secondary">
            <SyncIcon className="h-4 w-4" /> Ingest All Sources
          </button>
          <button type="button" disabled={!token || acting} onClick={() => void runAction('/api/v1/admin/reembed', {}, 'Re-embed queued')} className="btn btn-secondary">
            <RefreshIcon className="h-4 w-4" /> Re-embed Users
          </button>
          <button type="button" disabled={!token || acting} onClick={() => void runAction('/api/v1/admin/articles', { action: 'retry_failed', limit: 200 }, 'Failed articles re-queued')} className="btn btn-secondary">
            <PlayIcon className="h-4 w-4" /> Retry Failed Articles
          </button>
          <button type="button" disabled={!token || acting} onClick={() => void runAction('/api/v1/admin/articles', { action: 'delete_failed', limit: 200 }, 'Failed articles deleted')} className="btn btn-danger">
            <TrashIcon className="h-4 w-4" /> Cleanup Failed
          </button>
        </div>

        <div className="mt-6 border-t border-line pt-4">
          <h3 className="text-sm font-semibold text-ink">Manual Takedown</h3>
          <p className="mt-1 text-xs text-muted">Remove an article or card by ID</p>
          <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); void runAction('/api/v1/admin/takedown', { article_id: articleId.trim(), ...(reason.trim() ? { reason: reason.trim() } : {}) }, 'Removed'); }}>
            <input value={articleId} onChange={(e) => setArticleId(e.target.value)} className="field font-mono text-xs" placeholder="article_id or card_id" aria-label="ID" required />
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="field" placeholder="Reason (optional)" aria-label="Reason" />
            <button type="submit" disabled={!token || acting || !articleId.trim()} className="btn btn-danger"><TrashIcon className="h-4 w-4" /> Remove</button>
          </form>
        </div>
      </section>
    </>
  );

  const renderArticles = () => (
    <section className="surface-panel rounded-3xl p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Articles</h2>
          <p className="mt-1 text-xs text-muted">{articles?.total ?? 0} total</p>
        </div>
        <div className="flex gap-2">
          <select value={articleStatus} onChange={(e) => setArticleStatus(e.target.value)} className="field text-xs">
            <option value="">All Statuses</option>
            <option value="pending">pending</option>
            <option value="fetching">fetching</option>
            <option value="processing">processing</option>
            <option value="ready">ready</option>
            <option value="skipped">skipped</option>
            <option value="failed">failed</option>
          </select>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={articleSearch} onChange={(e) => setArticleSearch(e.target.value)} className="field pl-9 text-xs" placeholder="Search title…" />
          </div>
          <button type="button" onClick={() => void loadArticles()} className="btn btn-ghost px-3 py-1.5 text-xs"><RefreshIcon className="h-4 w-4" /></button>
        </div>
      </div>

      {/* Status legend */}
      <div className="mt-4 rounded-xl border border-line bg-elevated/30 p-3 text-xs text-muted">
        <p className="font-semibold text-ink">Article Lifecycle &amp; Unblock Guide</p>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          <p><span className="text-amber-400">pending</span> — Discovered, waiting for fetch. <em className="text-muted">Auto-processed by worker</em></p>
          <p><span className="text-blue-400">fetching</span> — Downloading HTML. <em className="text-muted">403/timeout → failed after retries</em></p>
          <p><span className="text-blue-400">processing</span> — HTML extracted, waiting for card. <em className="text-muted">Check LLM quota; run <code className="bg-ink/10 px-1 rounded">generate-card</code></em></p>
          <p><span className="text-green-400">ready</span> — Card generated with embedding. <em className="text-muted">Done ✓</em></p>
          <p><span className="text-gray-400">skipped</span> — Off-topic, duplicate, or manual skip. <em className="text-muted">Retry to re-process</em></p>
          <p><span className="text-red-400">failed</span> — Fetch/parse error (403, timeout, etc.). <em className="text-muted">Retry or delete</em></p>
        </div>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="py-2 pe-4 font-semibold">Status</th>
              <th className="py-2 pe-4 font-semibold">Title</th>
              <th className="py-2 pe-4 font-semibold">Attempts</th>
              <th className="py-2 pe-4 font-semibold">Last Error</th>
              <th className="py-2 pe-4 font-semibold">Content</th>
              <th className="py-2 pe-4 font-semibold">Created</th>
              <th className="py-2 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {articles?.items.map((a) => (
              <tr key={a.id} className="border-t border-line/60">
                <td className="py-2 pe-4"><StatusBadge status={a.status} /></td>
                <td className="py-2 pe-4 max-w-xs truncate font-medium text-ink" title={a.title}>{truncate(a.title, 40)}</td>
                <td className="py-2 pe-4 font-mono text-xs">{a.attempts}</td>
                <td className="py-2 pe-4 max-w-xs truncate text-xs text-muted" title={a.lastError ?? ''}>{a.lastError ?? '—'}</td>
                <td className="py-2 pe-4 text-xs">
                  {a.hasRawContent ? <span className="text-green-400">raw</span> : <span className="text-muted">—</span>}
                  {a.hasCleanedContent ? <span className="ml-1 text-green-400">clean</span> : ''}
                </td>
                <td className="py-2 pe-4 text-xs text-muted">{timeAgo(a.createdAt)}</td>
                <td className="py-2">
                  <div className="flex gap-1">
                    {a.status === 'failed' && (
                      <button type="button" disabled={acting} onClick={() => void articleAction(a.id, 'retry')} className="btn btn-ghost px-2 py-1 text-[0.7rem]" title="Retry fetch"><RefreshIcon className="h-3 w-3" /> Retry</button>
                    )}
                    {(a.status === 'pending' || a.status === 'skipped') && (
                      <button type="button" disabled={acting} onClick={() => void articleAction(a.id, 'retry')} className="btn btn-ghost px-2 py-1 text-[0.7rem]" title="Re-process"><PlayIcon className="h-3 w-3" /> Process</button>
                    )}
                    <button type="button" disabled={acting} onClick={() => void articleAction(a.id, 'skip')} className="btn btn-ghost px-2 py-1 text-[0.7rem] text-muted" title="Skip &amp; clear content"><SkipIcon className="h-3 w-3" /> Skip</button>
                    <button type="button" disabled={acting} onClick={() => void articleAction(a.id, 'delete')} className="btn btn-ghost px-2 py-1 text-[0.7rem] text-danger" title="Delete permanently"><TrashIcon className="h-3 w-3" /></button>
                  </div>
                </td>
              </tr>
            ))}
            {(!articles || articles.items.length === 0) && (
              <tr><td colSpan={7} className="py-8 text-center text-sm text-muted">No articles found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );

  const renderCards = () => (
    <section className="surface-panel rounded-3xl p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Cards</h2>
          <p className="mt-1 text-xs text-muted">{cards?.total ?? 0} total</p>
        </div>
        <div className="flex gap-2">
          <select value={cardStatus} onChange={(e) => setCardStatus(e.target.value)} className="field text-xs">
            <option value="">All Statuses</option>
            <option value="published">published</option>
            <option value="hidden">hidden</option>
            <option value="archived">archived</option>
          </select>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={cardSearch} onChange={(e) => setCardSearch(e.target.value)} className="field pl-9 text-xs" placeholder="Search hook…" />
          </div>
          <button type="button" onClick={() => void loadCards()} className="btn btn-ghost px-3 py-1.5 text-xs"><RefreshIcon className="h-4 w-4" /></button>
        </div>
      </div>

      {/* Card lifecycle guide */}
      <div className="mt-4 rounded-xl border border-line bg-elevated/30 p-3 text-xs text-muted">
        <p className="font-semibold text-ink">Card Lifecycle &amp; Unblock Guide</p>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          <p><span className="text-green-400">published</span> — Generated, visible in feed. <em className="text-muted">Has hook, concept, takeaways, embedding</em></p>
          <p><span className="text-gray-400">hidden</span> — Manually hidden. <em className="text-muted">Publish to restore</em></p>
          <p><span className="text-gray-400">archived</span> — Old/rotated out. <em className="text-muted">Regenerate if needed</em></p>
        </div>
        <p className="mt-2"><strong className="text-ink">To regenerate:</strong> Delete card → reset article to <code className="bg-ink/10 px-1 rounded">processing</code> → re-queue <code className="bg-ink/10 px-1 rounded">generate-card</code></p>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="py-2 pe-4 font-semibold">Status</th>
              <th className="py-2 pe-4 font-semibold">Hook</th>
              <th className="py-2 pe-4 font-semibold">Concept</th>
              <th className="py-2 pe-4 font-semibold">Embedding</th>
              <th className="py-2 pe-4 font-semibold">Tags</th>
              <th className="py-2 pe-4 font-semibold">Created</th>
              <th className="py-2 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {cards?.items.map((c) => (
              <tr key={c.id} className="border-t border-line/60">
                <td className="py-2 pe-4"><StatusBadge status={c.status} /></td>
                <td className="py-2 pe-4 max-w-xs truncate text-ink" title={c.hook}>{truncate(c.hook, 50)}</td>
                <td className="py-2 pe-4 max-w-xs truncate text-muted" title={c.coreConcept}>{truncate(c.coreConcept, 40)}</td>
                <td className="py-2 pe-4 text-xs">
                  {c.hasEmbedding ? <span className="text-green-400">✓ {c.embeddingDim}d</span> : <span className="text-red-400">✗</span>}
                  <span className="ml-1 text-muted">{c.embeddingModel}</span>
                </td>
                <td className="py-2 pe-4 text-xs text-muted">{c.topicTags.slice(0, 3).join(', ')}{c.topicTags.length > 3 ? '…' : ''}</td>
                <td className="py-2 pe-4 text-xs text-muted">{timeAgo(c.createdAt)}</td>
                <td className="py-2">
                  <div className="flex gap-1">
                    <button type="button" disabled={acting} onClick={() => void cardAction(c.id, 'regenerate')} className="btn btn-ghost px-2 py-1 text-[0.7rem]" title="Regenerate from article"><RefreshIcon className="h-3 w-3" /> Regen</button>
                    {c.status === 'hidden' && (
                      <button type="button" disabled={acting} onClick={() => void cardAction(c.id, 'publish')} className="btn btn-ghost px-2 py-1 text-[0.7rem] text-green-400" title="Publish"><PlayIcon className="h-3 w-3" /> Publish</button>
                    )}
                    {c.status === 'published' && (
                      <button type="button" disabled={acting} onClick={() => void cardAction(c.id, 'hide')} className="btn btn-ghost px-2 py-1 text-[0.7rem] text-muted" title="Hide"><PauseIcon className="h-3 w-3" /> Hide</button>
                    )}
                    <button type="button" disabled={acting} onClick={() => void cardAction(c.id, 'delete')} className="btn btn-ghost px-2 py-1 text-[0.7rem] text-danger" title="Delete"><TrashIcon className="h-3 w-3" /></button>
                  </div>
                </td>
              </tr>
            ))}
            {(!cards || cards.items.length === 0) && (
              <tr><td colSpan={7} className="py-8 text-center text-sm text-muted">No cards found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );

  const renderSources = () => (
    <section className="surface-panel rounded-3xl p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Sources</h2>
          <p className="mt-1 text-xs text-muted">{sources?.total ?? 0} total · {(sources?.items ?? []).filter(s => s.isActive).length} active</p>
        </div>
        <div className="flex gap-2">
          <select value={sourceActive} onChange={(e) => setSourceActive(e.target.value)} className="field text-xs">
            <option value="">All</option>
            <option value="true">Active only</option>
            <option value="false">Inactive only</option>
          </select>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={sourceSearch} onChange={(e) => setSourceSearch(e.target.value)} className="field pl-9 text-xs" placeholder="Search title…" />
          </div>
          <button type="button" onClick={() => void loadSources()} className="btn btn-ghost px-3 py-1.5 text-xs"><RefreshIcon className="h-4 w-4" /></button>
        </div>
      </div>

      {/* Source lifecycle guide */}
      <div className="mt-4 rounded-xl border border-line bg-elevated/30 p-3 text-xs text-muted">
        <p className="font-semibold text-ink">Source Lifecycle &amp; Unblock Guide</p>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          <p><span className="text-green-400">active</span> — Scheduled for fetch. <em className="text-muted">Auto-ingested by worker</em></p>
          <p><span className="text-gray-400">inactive</span> — Disabled or auto-deactivated (3 failures). <em className="text-muted">Activate or reset failures</em></p>
        </div>
        <p className="mt-2"><strong className="text-ink">Auto-deactivation:</strong> 3 consecutive failures within 10 min → <code className="bg-ink/10 px-1 rounded">isActive = false</code>. Use <em>Reset Failures</em> to reactivate.</p>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="py-2 pe-4 font-semibold">Status</th>
              <th className="py-2 pe-4 font-semibold">Title</th>
              <th className="py-2 pe-4 font-semibold">Type</th>
              <th className="py-2 pe-4 font-semibold">Interval</th>
              <th className="py-2 pe-4 font-semibold">Last Fetch</th>
              <th className="py-2 pe-4 font-semibold">Next Fetch</th>
              <th className="py-2 pe-4 font-semibold">Failures</th>
              <th className="py-2 pe-4 font-semibold">Articles</th>
              <th className="py-2 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sources?.items.map((s) => (
              <tr key={s.id} className="border-t border-line/60">
                <td className="py-2 pe-4">
                  {s.isActive ? <span className="text-green-400">●</span> : <span className="text-gray-400">○</span>}
                </td>
                <td className="py-2 pe-4 max-w-xs truncate font-medium text-ink" title={s.title}>{truncate(s.title, 35)}</td>
                <td className="py-2 pe-4 text-xs text-muted">{s.sourceType}</td>
                <td className="py-2 pe-4 text-xs font-mono">{s.fetchIntervalMinutes}m</td>
                <td className="py-2 pe-4 text-xs text-muted">{timeAgo(s.lastFetchedAt)}</td>
                <td className="py-2 pe-4 text-xs text-muted">{s.nextFetchAt ? timeAgo(s.nextFetchAt) : '—'}</td>
                <td className="py-2 pe-4">
                  <span className={cn('font-mono text-xs', s.consecutiveFailures > 0 ? 'text-danger' : 'text-muted')}>{s.consecutiveFailures}</span>
                  {s.lastError && <span className="ml-1 text-[0.65rem] text-muted" title={s.lastError}>⚠</span>}
                </td>
                <td className="py-2 pe-4 text-xs font-mono">{s.articlesCount}</td>
                <td className="py-2">
                  <div className="flex gap-1">
                    {!s.isActive && (
                      <button type="button" disabled={acting} onClick={() => void sourceAction(s.id, 'activate')} className="btn btn-ghost px-2 py-1 text-[0.7rem] text-green-400" title="Activate"><PlayIcon className="h-3 w-3" /> On</button>
                    )}
                    {s.isActive && (
                      <button type="button" disabled={acting} onClick={() => void sourceAction(s.id, 'deactivate')} className="btn btn-ghost px-2 py-1 text-[0.7rem] text-muted" title="Deactivate"><PauseIcon className="h-3 w-3" /> Off</button>
                    )}
                    <button type="button" disabled={acting} onClick={() => void sourceAction(s.id, 'ingest')} className="btn btn-ghost px-2 py-1 text-[0.7rem]" title="Force ingest"><SyncIcon className="h-3 w-3" /> Fetch</button>
                    {s.consecutiveFailures > 0 && (
                      <button type="button" disabled={acting} onClick={() => void sourceAction(s.id, 'reset_failures')} className="btn btn-ghost px-2 py-1 text-[0.7rem] text-amber-400" title="Reset failures & reactivate"><RefreshIcon className="h-3 w-3" /> Reset</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {(!sources || sources.items.length === 0) && (
              <tr><td colSpan={9} className="py-8 text-center text-sm text-muted">No sources found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );

  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeading eyebrow={t('appName')} titleKey="adminTitle" subtitleKey="adminSubtitle" icon={ShieldIcon} />

      {/* Token bar */}
      <div className="grid gap-4 px-4 sm:px-6 lg:grid-cols-2 lg:px-10">
        <section className="surface-panel rounded-3xl p-5 sm:p-6 lg:col-span-2">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold">Admin Access</h2>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">Enter your admin token to unlock the dashboard</p>
            </div>
            <button type="button" onClick={forget} className="btn btn-ghost px-3 py-1.5 text-xs">Lock</button>
          </div>
          <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); unlock(); }}>
            <input type="password" value={draftToken} onChange={(e) => setDraftToken(e.target.value)} className="field max-w-xl" placeholder="Admin token…" autoComplete="off" />
            <button type="submit" className="btn btn-primary shrink-0">Unlock</button>
            <button type="button" onClick={() => void load()} disabled={!token || loading} className="btn btn-secondary shrink-0">
              <SyncIcon className={cn('h-4 w-4', loading && 'animate-spin')} /> Refresh
            </button>
          </form>
          {error && <p role="alert" className="mt-3 text-sm font-semibold text-danger">{error}</p>}
        </section>
      </div>

      {/* Tabs */}
      {token && (
        <div className="px-4 sm:px-6 lg:px-10">
          <div className="flex gap-1 border-b border-line">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                  activeTab === tab.id
                    ? 'border-accent text-accent'
                    : 'border-transparent text-muted hover:text-ink',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tab content */}
      {token && (
        <div className="grid gap-4 px-4 sm:px-6 lg:px-10">
          {activeTab === 'overview' && renderOverview()}
          {activeTab === 'articles' && renderArticles()}
          {activeTab === 'cards' && renderCards()}
          {activeTab === 'sources' && renderSources()}
        </div>
      )}
    </div>
  );
}
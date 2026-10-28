import Parser from 'rss-parser';
import { htmlToText, normalizeText } from './html';
import { resolveUrl } from './url';
import { safeFetch, type FetchLike, type ResolveHost } from './ssrf';

export const FEED_CONTENT_TYPES = [
  'application/rss+xml',
  'application/atom+xml',
  'application/feed+json',
  'application/rdf+xml',
  'application/xml',
  'text/xml',
] as const;

export interface FeedItem {
  externalId: string;
  url: string;
  title: string;
  publishedAt: string | null;
  author: string | null;
  contentHtml: string;
  contentText: string;
  summary: string | null;
}

export interface ParsedFeed {
  title: string;
  description: string | null;
  siteUrl: string | null;
  language: string | null;
  items: FeedItem[];
}

export interface FetchFeedOptions {
  etag?: string | null;
  lastModified?: string | null;
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: FetchLike;
  resolveHost?: ResolveHost;
}

export interface FetchFeedResult {
  notModified: boolean;
  url: string;
  etag: string | null;
  lastModified: string | null;
  feed: ParsedFeed | null;
}

export class FeedParseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FeedParseError';
  }
}

export class FeedFetchError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'FeedFetchError';
    this.status = status;
  }
}

const parser = new Parser({
  timeout: 10_000,
  customFields: {
    feed: ['language'],
    item: ['author', 'content:encoded'],
  },
});

const MAX_TITLE_CHARS = 512;
const MAX_AUTHOR_CHARS = 255;
const MAX_LANGUAGE_CHARS = 16;
const MAX_SUMMARY_CHARS = 4_000;
const MAX_DESCRIPTION_CHARS = 2_000;
const MAX_ID_CHARS = 2_048;
const MAX_URL_CHARS = 2_048;
const MAX_CONTENT_CHARS = 5 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rawString(value: unknown, maxChars: number): string | undefined {
  return typeof value === 'string' ? value.slice(0, maxChars) : undefined;
}

function cleanText(value: unknown, maxChars: number): string {
  return normalizeText(rawString(value, maxChars) ?? '').slice(0, maxChars);
}

function cleanOptionalText(value: unknown, maxChars: number): string | null {
  return cleanText(value, maxChars) || null;
}

function parseDate(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function itemUrl(
  input: string | undefined,
  feedUrl: string,
): string | null {
  if (!input) {
    return null;
  }
  try {
    return resolveUrl(input, feedUrl);
  } catch {
    return null;
  }
}

function firstAuthorName(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const first: unknown = value[0];
  if (!isRecord(first)) {
    return null;
  }
  return cleanOptionalText(first.name, MAX_AUTHOR_CHARS);
}

function normalizeJsonFeed(
  raw: unknown,
  feedUrl: string,
  maxItems: number,
): ParsedFeed {
  if (!isRecord(raw)) {
    throw new FeedParseError('Invalid JSON feed');
  }

  const rawItems = raw.items;
  if (rawItems !== undefined && !Array.isArray(rawItems)) {
    throw new FeedParseError('Invalid JSON feed: "items" must be an array');
  }

  const items: FeedItem[] = [];

  for (const rawItem of rawItems ?? []) {
    if (!isRecord(rawItem)) {
      continue;
    }

    const id = rawString(rawItem.id, MAX_ID_CHARS);
    const url = itemUrl(
      rawString(rawItem.url, MAX_URL_CHARS) ??
        rawString(rawItem.external_url, MAX_URL_CHARS) ??
        (id?.startsWith('http') ? id : undefined),
      feedUrl,
    );
    if (!url) {
      continue;
    }

    const contentHtml =
      rawString(rawItem.content_html, MAX_CONTENT_CHARS) ?? '';
    const summary = cleanOptionalText(rawItem.summary, MAX_SUMMARY_CHARS);
    const contentText = cleanText(
      rawString(rawItem.content_text, MAX_CONTENT_CHARS) ??
        (contentHtml ? htmlToText(contentHtml) : undefined) ??
        summary ??
        '',
      MAX_CONTENT_CHARS,
    );

    items.push({
      externalId: id ?? url,
      url,
      title: cleanText(rawItem.title, MAX_TITLE_CHARS) || 'Untitled',
      publishedAt: parseDate(rawString(rawItem.date_published, 64)),
      author: firstAuthorName(rawItem.authors),
      contentHtml,
      contentText,
      summary,
    });

    if (items.length >= maxItems) {
      break;
    }
  }

  return {
    title: cleanText(raw.title, MAX_TITLE_CHARS) || 'Untitled feed',
    description: cleanOptionalText(raw.description, MAX_DESCRIPTION_CHARS),
    siteUrl: itemUrl(rawString(raw.home_page_url, MAX_URL_CHARS), feedUrl),
    language: cleanOptionalText(raw.language, MAX_LANGUAGE_CHARS),
    items,
  };
}

export async function parseFeed(
  body: string,
  feedUrl: string,
  contentType = '',
  maxItems = 100,
): Promise<ParsedFeed> {
  const trimmed = body.trim();
  if (
    contentType.toLowerCase().includes('json') ||
    trimmed.startsWith('{')
  ) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed) as unknown;
    } catch (error) {
      throw new FeedParseError('Invalid JSON feed', { cause: error });
    }
    return normalizeJsonFeed(json, feedUrl, maxItems);
  }

  let parsed: Awaited<ReturnType<typeof parser.parseString>> & {
    language?: string;
  };
  try {
    parsed = (await parser.parseString(body)) as typeof parsed;
  } catch (error) {
    throw new FeedParseError('Invalid RSS or Atom feed', { cause: error });
  }

  const items: FeedItem[] = [];
  const rawItems: unknown[] = Array.isArray(parsed.items) ? parsed.items : [];
  for (const item of rawItems) {
    if (!isRecord(item)) {
      continue;
    }

    const url = itemUrl(
      rawString(item.link, MAX_URL_CHARS) ?? rawString(item.guid, MAX_URL_CHARS),
      feedUrl,
    );
    if (!url) {
      continue;
    }

    const contentHtml =
      rawString(item.content, MAX_CONTENT_CHARS) ??
      rawString(item.summary, MAX_CONTENT_CHARS) ??
      '';
    const contentText = cleanText(
      rawString(item.contentSnippet, MAX_CONTENT_CHARS) ??
        htmlToText(contentHtml),
      MAX_CONTENT_CHARS,
    );

    items.push({
      externalId: rawString(item.guid, MAX_ID_CHARS) ?? url,
      url,
      title: cleanText(item.title, MAX_TITLE_CHARS) || 'Untitled',
      publishedAt: parseDate(
        rawString(item.isoDate, 64) ?? rawString(item.pubDate, 64),
      ),
      author: cleanOptionalText(item.creator, MAX_AUTHOR_CHARS),
      contentHtml,
      contentText,
      summary: cleanOptionalText(item.summary, MAX_SUMMARY_CHARS),
    });

    if (items.length >= maxItems) {
      break;
    }
  }

  return {
    title: cleanText(parsed.title, MAX_TITLE_CHARS) || 'Untitled feed',
    description: cleanOptionalText(parsed.description, MAX_DESCRIPTION_CHARS),
    siteUrl: parsed.link
      ? itemUrl(rawString(parsed.link, MAX_URL_CHARS), feedUrl)
      : null,
    language: cleanOptionalText(parsed.language, MAX_LANGUAGE_CHARS),
    items,
  };
}

export async function fetchFeed(
  url: string,
  options: FetchFeedOptions = {},
): Promise<FetchFeedResult> {
  const headers: Record<string, string> = {
    accept: FEED_CONTENT_TYPES.join(', '),
    'user-agent': 'OpenScroll/0.1 (+https://github.com/openscroll/openscroll)',
  };
  if (options.etag) {
    headers['if-none-match'] = options.etag;
  }
  if (options.lastModified) {
    headers['if-modified-since'] = options.lastModified;
  }

  const response = await safeFetch(url, {
    headers,
    timeoutMs: options.timeoutMs ?? 10_000,
    maxBytes: options.maxBytes ?? 5 * 1024 * 1024,
    maxRedirects: 3,
    allowedContentTypes: [...FEED_CONTENT_TYPES],
    fetchImpl: options.fetchImpl,
    resolveHost: options.resolveHost,
  });

  const etag = response.headers.get('etag');
  const lastModified = response.headers.get('last-modified');

  if (response.status === 304) {
    return {
      notModified: true,
      url: response.url,
      etag,
      lastModified,
      feed: null,
    };
  }

  if (!response.ok) {
    throw new FeedFetchError(
      `Feed request failed with status ${response.status}`,
      response.status,
    );
  }

  return {
    notModified: false,
    url: response.url,
    etag,
    lastModified,
    feed: await parseFeed(response.text(), response.url, response.contentType),
  };
}

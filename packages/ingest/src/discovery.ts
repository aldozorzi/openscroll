import { parseHTML } from 'linkedom';
import { FEED_CONTENT_TYPES } from './feed';
import { safeFetch, type FetchLike, type ResolveHost } from './ssrf';
import { resolveUrl } from './url';

const FEED_MIME_TYPES = new Set(FEED_CONTENT_TYPES.map((type) => type.toLowerCase()));
const HTML_MIME_TYPES = ['text/html', 'application/xhtml+xml'];
const MAX_FEED_LINKS = 50;

export interface DiscoveredFeed {
  url: string;
  contentType: string;
}

export interface DiscoverFeedOptions {
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  resolveHost?: ResolveHost;
}

export function extractFeedLinks(html: string, baseUrl: string): string[] {
  const { document } = parseHTML(html);
  const links: string[] = [];

  for (const element of document.querySelectorAll('link[rel][type][href]')) {
    const rel = (element.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
    const type = ((element.getAttribute('type') ?? '').split(';')[0] ?? '')
      .trim()
      .toLowerCase();
    const href = element.getAttribute('href');

    if (!rel.includes('alternate') || !href || !FEED_MIME_TYPES.has(type)) {
      continue;
    }

    try {
      const url = resolveUrl(href, baseUrl);
      if (!links.includes(url)) {
        links.push(url);
      }
    } catch {
      // Ignore malformed feed links.
    }

    // Discovery only needs the first usable link; cap collection so a hostile
    // 5 MiB HTML page cannot force unbounded work.
    if (links.length >= MAX_FEED_LINKS) {
      break;
    }
  }

  return links;
}

function normalizeContentType(contentType: string): string {
  return (contentType.split(';')[0] ?? '').trim().toLowerCase();
}

export async function discoverFeed(
  inputUrl: string,
  options: DiscoverFeedOptions = {},
): Promise<DiscoveredFeed | null> {
  try {
    const response = await safeFetch(inputUrl, {
      timeoutMs: options.timeoutMs ?? 10_000,
      maxBytes: 5 * 1024 * 1024,
      maxRedirects: 3,
      allowedContentTypes: [...HTML_MIME_TYPES, ...FEED_CONTENT_TYPES],
      fetchImpl: options.fetchImpl,
      resolveHost: options.resolveHost,
    });

    if (!response.ok) {
      return null;
    }

    const contentType = normalizeContentType(response.contentType);
    if (FEED_MIME_TYPES.has(contentType)) {
      return { url: response.url, contentType };
    }

    const links = extractFeedLinks(response.text(), response.url);
    if (links[0]) {
      return { url: links[0], contentType: '' };
    }

    const commonPaths = [
      '/feed',
      '/rss',
      '/rss.xml',
      '/atom.xml',
      '/index.xml',
      '/feed.json',
    ];

    for (const path of commonPaths) {
      const candidate = new URL(path, response.url).toString();
      try {
        const probe = await safeFetch(candidate, {
          timeoutMs: 5_000,
          maxBytes: 64 * 1024,
          maxRedirects: 2,
          allowedContentTypes: [...FEED_CONTENT_TYPES],
          fetchImpl: options.fetchImpl,
          resolveHost: options.resolveHost,
        });
        if (probe.ok) {
          return {
            url: probe.url,
            contentType: normalizeContentType(probe.contentType),
          };
        }
      } catch {
        // Probe the next candidate.
      }
    }
  } catch {
    return null;
  }

  return null;
}

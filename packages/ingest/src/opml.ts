import { DOMParser } from 'linkedom';
import type { SourceType } from '@openscroll/contracts';
import { canonicalizeUrl } from './url';

export interface OpmlFeed {
  url: string;
  title: string;
  category: string | null;
  sourceType: SourceType;
}

export class OpmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpmlError';
  }
}

function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi,
    (match, entity: string) => {
      const normalized = entity.toLowerCase();
      if (normalized.startsWith('#x') || normalized.startsWith('#')) {
        const radix = normalized.startsWith('#x') ? 16 : 10;
        const raw = normalized.slice(radix === 16 ? 2 : 1);
        const codePoint = Number.parseInt(raw, radix);
        if (
          !Number.isInteger(codePoint) ||
          codePoint < 0 ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return match;
        }
        return String.fromCodePoint(codePoint);
      }
      switch (normalized) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        default:
          return match;
      }
    },
  );
}

function sourceType(value: string | null): SourceType {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'atom') {
    return 'ATOM';
  }
  if (normalized === 'json' || normalized === 'json_feed') {
    return 'JSON_FEED';
  }
  return 'RSS';
}

function outlineTitle(element: Element): string {
  const title =
    element.getAttribute('title')?.trim() ||
    element.getAttribute('text')?.trim() ||
    '';
  return decodeEntities(title).slice(0, MAX_TITLE_CHARS);
}

const MAX_TITLE_CHARS = 255;
const MAX_CATEGORY_CHARS = 80;
const MAX_DEPTH = 32;

function collect(
  container: Element,
  category: string | null,
  feeds: OpmlFeed[],
  seen: Set<string>,
  depth: number,
): void {
  if (depth > MAX_DEPTH) {
    throw new OpmlError('OPML nesting is too deep');
  }

  for (const element of container.children) {
    if (element.tagName.toLowerCase() !== 'outline') {
      continue;
    }

    const rawUrl =
      element.getAttribute('xmlUrl') ?? element.getAttribute('xmlurl');
    if (rawUrl) {
      try {
        const url = canonicalizeUrl(decodeEntities(rawUrl));
        if (!seen.has(url)) {
          seen.add(url);
          feeds.push({
            url,
            title: outlineTitle(element) || new URL(url).hostname,
            category: category?.slice(0, MAX_CATEGORY_CHARS) ?? null,
            sourceType: sourceType(element.getAttribute('type')),
          });
        }
      } catch {
        // Skip malformed feed URLs.
      }
      continue;
    }

    const group = outlineTitle(element) || category;
    collect(element, group, feeds, seen, depth + 1);
  }
}

export interface ParseOpmlOptions {
  maxBytes?: number;
  maxFeeds?: number;
}

export function parseOpml(
  xml: string,
  options: ParseOpmlOptions = {},
): OpmlFeed[] {
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  if (Buffer.byteLength(xml, 'utf8') > maxBytes) {
    throw new OpmlError('OPML file exceeds the size limit');
  }

  // Reject entity declarations: OPML never needs them, and parsers that do
  // expand internal entities would otherwise allow expansion attacks.
  if (/<!DOCTYPE/i.test(xml)) {
    throw new OpmlError('OPML files must not contain a DOCTYPE declaration');
  }

  let document;
  try {
    document = new DOMParser().parseFromString(xml, 'text/xml');
  } catch {
    throw new OpmlError('Invalid OPML file');
  }

  const body = document.querySelector('body');
  if (!body) {
    throw new OpmlError('Invalid OPML file');
  }

  const feeds: OpmlFeed[] = [];
  collect(body, null, feeds, new Set(), 0);
  return feeds.slice(0, options.maxFeeds ?? 10_000);
}

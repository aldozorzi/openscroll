import { XMLParser } from 'fast-xml-parser';
import { canonicalizeUrl } from '@openscroll/ingest';

export interface OpmlFeed {
  url: string;
  title: string;
}

interface OutlineNode {
  text?: unknown;
  title?: unknown;
  xmlUrl?: unknown;
  type?: unknown;
  outline?: OutlineNode | OutlineNode[];
}

export class OpmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpmlError';
  }
}

export const OPML_MAX_BYTES = 1024 * 1024;
export const OPML_MAX_FEEDS = 100;
export const OPML_MAX_DEPTH = 32;
export const OPML_MAX_NODES = 10_000;
const MAX_TITLE_CHARS = 255;

interface CollectState {
  feeds: OpmlFeed[];
  seen: Set<string>;
  nodes: number;
}

function collect(
  node: OutlineNode | OutlineNode[] | undefined,
  state: CollectState,
  depth: number,
): void {
  if (!node) {
    return;
  }
  if (depth > OPML_MAX_DEPTH) {
    throw new OpmlError('OPML nesting is too deep');
  }
  state.nodes += 1;
  if (state.nodes > OPML_MAX_NODES) {
    throw new OpmlError('OPML contains too many nodes');
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      collect(child, state, depth);
    }
    return;
  }

  if (typeof node.xmlUrl === 'string') {
    try {
      const url = canonicalizeUrl(node.xmlUrl);
      if (!state.seen.has(url)) {
        state.seen.add(url);
        const rawTitle =
          typeof node.title === 'string'
            ? node.title
            : typeof node.text === 'string'
              ? node.text
              : '';
        const title = rawTitle.trim().slice(0, MAX_TITLE_CHARS);
        state.feeds.push({ url, title: title || new URL(url).hostname });
      }
    } catch {
      // Skip malformed OPML feed URLs.
    }
  }

  collect(node.outline, state, depth + 1);
}

export function parseOpmlFeeds(xml: string): OpmlFeed[] {
  if (Buffer.byteLength(xml, 'utf8') > OPML_MAX_BYTES) {
    throw new OpmlError('OPML file exceeds the 1 MB limit');
  }

  // fast-xml-parser resolves internal entities, so a DOCTYPE can be used for
  // entity expansion. OPML never legitimately needs one: reject it outright.
  if (/<!DOCTYPE/i.test(xml)) {
    throw new OpmlError('OPML files must not contain a DOCTYPE declaration');
  }

  let parsed: { opml?: { body?: { outline?: OutlineNode | OutlineNode[] } } };
  try {
    parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      parseAttributeValue: false,
      trimValues: true,
    }).parse(xml) as typeof parsed;
  } catch {
    throw new OpmlError('Invalid OPML file');
  }

  if (!parsed.opml) {
    throw new OpmlError('Invalid OPML file');
  }

  const state: CollectState = { feeds: [], seen: new Set(), nodes: 0 };
  collect(parsed.opml.body?.outline, state, 0);
  return state.feeds.slice(0, OPML_MAX_FEEDS);
}

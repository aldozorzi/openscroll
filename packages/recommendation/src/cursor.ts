import { FEED_MODES, type FeedMode } from '@openscroll/contracts';
import { InvalidCursorError } from './errors';
import type { RankedCandidate } from './types';

const CURSOR_VERSION = 1;
const SCORE_EPSILON = 1e-12;

export interface FeedCursor {
  v: typeof CURSOR_VERSION;
  score: number;
  id: string;
  seed: string;
  mode: FeedMode;
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(padding));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

export function encodeCursor(payload: Omit<FeedCursor, 'v'>): string {
  return encodeBase64Url(JSON.stringify({ v: CURSOR_VERSION, ...payload }));
}

function isFeedMode(value: unknown): value is FeedMode {
  return typeof value === 'string' && (FEED_MODES as readonly string[]).includes(value);
}

export function decodeCursor(value: string): FeedCursor {
  if (!value || value.length > 2048) {
    throw new InvalidCursorError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeBase64Url(value));
  } catch {
    throw new InvalidCursorError();
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new InvalidCursorError();
  }

  const record = parsed as Record<string, unknown>;
  if (
    record.v !== CURSOR_VERSION ||
    typeof record.score !== 'number' ||
    !Number.isFinite(record.score) ||
    record.score < 0 ||
    record.score > 1 ||
    typeof record.id !== 'string' ||
    record.id.length === 0 ||
    record.id.length > 100 ||
    typeof record.seed !== 'string' ||
    record.seed.length === 0 ||
    record.seed.length > 200 ||
    !isFeedMode(record.mode)
  ) {
    throw new InvalidCursorError();
  }

  return {
    v: CURSOR_VERSION,
    score: record.score,
    id: record.id,
    seed: record.seed,
    mode: record.mode,
  };
}

export function applyCursor(
  ranked: readonly RankedCandidate[],
  cursor: FeedCursor | null,
): RankedCandidate[] {
  if (!cursor) {
    return [...ranked];
  }

  return ranked.filter((entry) => {
    if (entry.candidate.id === cursor.id) {
      return false;
    }
    if (entry.score < cursor.score - SCORE_EPSILON) {
      return true;
    }
    if (Math.abs(entry.score - cursor.score) <= SCORE_EPSILON) {
      return entry.candidate.id > cursor.id;
    }
    return false;
  });
}

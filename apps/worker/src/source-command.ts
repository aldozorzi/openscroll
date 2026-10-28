import type { SourceType } from '@openscroll/contracts';
import { MAX_URL_LENGTH } from '@openscroll/ingest';

const MAX_TITLE_CHARS = 255;
const MAX_CATEGORY_CHARS = 80;
const MAX_INTERVAL_MINUTES = 10_080;

const FEED_TYPES: Record<string, SourceType> = {
  rss: 'RSS',
  atom: 'ATOM',
  json: 'JSON_FEED',
  json_feed: 'JSON_FEED',
};

export interface AddSourceOptions {
  url: string;
  title?: string;
  category?: string;
  intervalMinutes: number;
  sourceType?: SourceType;
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseAddSourceArgs(argv: string[]): AddSourceOptions {
  let url: string | undefined;
  let title: string | undefined;
  let category: string | undefined;
  let sourceType: SourceType | undefined;
  let intervalMinutes = 60;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) {
      continue;
    }

    if (argument === '--title') {
      title = readValue(argv, index, '--title').trim().slice(0, MAX_TITLE_CHARS);
      index += 1;
      continue;
    }
    if (argument === '--category') {
      category = readValue(argv, index, '--category')
        .trim()
        .slice(0, MAX_CATEGORY_CHARS);
      index += 1;
      continue;
    }
    if (argument === '--type') {
      const value = readValue(argv, index, '--type').toLowerCase();
      const parsed = FEED_TYPES[value];
      if (!parsed) {
        throw new Error('--type must be one of: rss, atom, json');
      }
      sourceType = parsed;
      index += 1;
      continue;
    }
    if (argument === '--interval') {
      const value = Number(readValue(argv, index, '--interval'));
      if (!Number.isInteger(value) || value < 1) {
        throw new Error('--interval must be a positive integer (minutes)');
      }
      if (value > MAX_INTERVAL_MINUTES) {
        throw new Error(
          `--interval must not exceed ${MAX_INTERVAL_MINUTES} minutes (one week)`,
        );
      }
      intervalMinutes = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('--')) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (url) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    url = argument;
  }

  if (!url) {
    throw new Error('A feed URL is required');
  }

  if (url.length > MAX_URL_LENGTH) {
    throw new Error(
      `The feed URL must not exceed ${MAX_URL_LENGTH} characters`,
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('The feed URL is not valid');
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Only http and https feed URLs are supported');
  }

  return {
    url: parsedUrl.toString(),
    title: title || undefined,
    category: category || undefined,
    intervalMinutes,
    sourceType,
  };
}

export function sourceTypeFromContentType(contentType: string): SourceType {
  const normalized = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (normalized === 'application/atom+xml') {
    return 'ATOM';
  }
  if (normalized === 'application/feed+json') {
    return 'JSON_FEED';
  }
  return 'RSS';
}

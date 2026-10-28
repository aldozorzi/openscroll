import { describe, expect, it } from 'vitest';
import {
  parseAddSourceArgs,
  sourceTypeFromContentType,
} from './source-command';

describe('source command', () => {
  it('parses a URL with defaults', () => {
    expect(parseAddSourceArgs(['https://example.com/feed.xml'])).toEqual({
      url: 'https://example.com/feed.xml',
      title: undefined,
      category: undefined,
      intervalMinutes: 60,
      sourceType: undefined,
    });
  });

  it('parses options and overrides', () => {
    expect(
      parseAddSourceArgs([
        'https://example.com/feed',
        '--title',
        'Example',
        '--category',
        'technology',
        '--interval',
        '15',
        '--type',
        'atom',
      ]),
    ).toEqual({
      url: 'https://example.com/feed',
      title: 'Example',
      category: 'technology',
      intervalMinutes: 15,
      sourceType: 'ATOM',
    });
  });

  it('rejects invalid input', () => {
    expect(() => parseAddSourceArgs([])).toThrow(/URL is required/);
    expect(() => parseAddSourceArgs(['ftp://example.com/feed'])).toThrow(
      /http and https/,
    );
    expect(() =>
      parseAddSourceArgs(['https://example.com', '--interval', '0']),
    ).toThrow(/positive integer/);
    expect(() =>
      parseAddSourceArgs(['https://example.com', '--type', 'api']),
    ).toThrow(/rss, atom, json/);
    expect(() =>
      parseAddSourceArgs(['https://example.com', '--interval', '10081']),
    ).toThrow(/one week/);
    expect(() =>
      parseAddSourceArgs([`https://example.com/${'a'.repeat(2_048)}`]),
    ).toThrow(/must not exceed/);
    expect(() =>
      parseAddSourceArgs(['https://example.com', '--unknown']),
    ).toThrow(/Unknown option/);
  });

  it('caps metadata lengths', () => {
    const options = parseAddSourceArgs([
      'https://example.com/feed',
      '--title',
      't'.repeat(400),
      '--category',
      'c'.repeat(200),
    ]);
    expect(options.title).toHaveLength(255);
    expect(options.category).toHaveLength(80);
  });

  it('maps feed content types', () => {
    expect(sourceTypeFromContentType('application/atom+xml; charset=utf-8')).toBe(
      'ATOM',
    );
    expect(sourceTypeFromContentType('application/feed+json')).toBe('JSON_FEED');
    expect(sourceTypeFromContentType('application/rss+xml')).toBe('RSS');
    expect(sourceTypeFromContentType('')).toBe('RSS');
  });
});

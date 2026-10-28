import { describe, expect, it } from 'vitest';
import { parseImportArgs } from './source-import';

describe('source import arguments', () => {
  it('parses a target with defaults', () => {
    expect(parseImportArgs(['/tmp/feeds'])).toEqual({
      target: '/tmp/feeds',
      activateCategories: [],
      intervalMinutes: 360,
      limit: null,
      dryRun: false,
    });
  });

  it('parses category activation and filters', () => {
    expect(
      parseImportArgs([
        'https://example.com/feeds.opml',
        '--activate-category',
        'Tech',
        '--activate-category',
        'Italy',
        '--interval',
        '60',
        '--limit',
        '20',
        '--dry-run',
      ]),
    ).toEqual({
      target: 'https://example.com/feeds.opml',
      activateCategories: ['Tech', 'Italy'],
      intervalMinutes: 60,
      limit: 20,
      dryRun: true,
    });
  });

  it('rejects invalid input', () => {
    expect(() => parseImportArgs([])).toThrow(/required/);
    expect(() => parseImportArgs(['/tmp/feeds', '--interval', '0'])).toThrow(
      /positive integer/,
    );
    expect(() => parseImportArgs(['/tmp/feeds', '--limit', 'x'])).toThrow(
      /positive integer/,
    );
    expect(() =>
      parseImportArgs(['/tmp/feeds', '--interval', '10081']),
    ).toThrow(/one week/);
    expect(() =>
      parseImportArgs(['/tmp/feeds', '--activate-category']),
    ).toThrow(/requires a value/);
  });

  it('caps category names', () => {
    const options = parseImportArgs([
      '/tmp/feeds',
      '--activate-category',
      'c'.repeat(200),
    ]);
    expect(options.activateCategories[0]).toHaveLength(80);
  });
});

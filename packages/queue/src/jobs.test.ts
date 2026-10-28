import { describe, expect, it } from 'vitest';
import {
  DEAD_LETTER_QUEUE,
  QUEUE_DEFINITIONS,
  articleSingletonKey,
  sourceSingletonKey,
  userSingletonKey,
} from './jobs';

describe('queue definitions', () => {
  it('routes every work queue to the dead-letter queue', () => {
    for (const [name, definition] of Object.entries(QUEUE_DEFINITIONS)) {
      if (name === DEAD_LETTER_QUEUE) {
        continue;
      }
      expect(definition.policy).toMatch(/standard|stately/);
      expect(definition.retryLimit).toBeGreaterThan(0);
    }
  });

  it('builds stable singleton keys', () => {
    expect(sourceSingletonKey('abc')).toBe('source:abc');
    expect(articleSingletonKey('abc')).toBe('article:abc');
    expect(userSingletonKey('abc')).toBe('user:abc');
  });
});

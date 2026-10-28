import { describe, expect, it } from 'vitest';
import {
  SOURCE_FAILURE_THRESHOLD,
  SOURCE_FAILURE_WINDOW_MS,
  nextFailureCount,
  shouldDeactivateSource,
  sourceErrorMessage,
} from './source-health';

describe('source failure tracking', () => {
  const now = new Date('2026-10-23T12:00:00.000Z');

  it('counts one failure per retry window', () => {
    const first = nextFailureCount(0, null, now);
    expect(first).toBe(1);

    const retry = nextFailureCount(
      first,
      new Date(now.getTime() - SOURCE_FAILURE_WINDOW_MS / 2),
      now,
    );
    expect(retry).toBe(1);

    const nextCycle = nextFailureCount(
      first,
      new Date(now.getTime() - SOURCE_FAILURE_WINDOW_MS),
      now,
    );
    expect(nextCycle).toBe(2);
  });

  it('starts a new count after a successful fetch', () => {
    expect(
      nextFailureCount(
        0,
        new Date(now.getTime() - SOURCE_FAILURE_WINDOW_MS / 2),
        now,
      ),
    ).toBe(1);
  });

  it('deactivates at the failure threshold', () => {
    expect(SOURCE_FAILURE_THRESHOLD).toBe(3);
    expect(shouldDeactivateSource(2)).toBe(false);
    expect(shouldDeactivateSource(3)).toBe(true);
  });

  it('truncates long error messages', () => {
    expect(sourceErrorMessage(new Error('x'.repeat(2_000)))).toHaveLength(1_000);
  });
});

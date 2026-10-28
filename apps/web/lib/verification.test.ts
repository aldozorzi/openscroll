import { describe, expect, it } from 'vitest';
import {
  EMAIL_VERIFICATION_DAILY_WINDOW_MS,
  EMAIL_VERIFICATION_PER_ADDRESS_DAILY_LIMIT,
  evaluateVerificationBudget,
  normalizeEmail,
} from './verification';

describe('normalizeEmail', () => {
  it('trims and lowercases addresses', () => {
    expect(normalizeEmail(' Reader@Example.COM ')).toBe('reader@example.com');
  });
});

describe('evaluateVerificationBudget', () => {
  it('allows a send when both budgets have room', () => {
    expect(
      evaluateVerificationBudget({
        recentSends: 0,
        addressSends24h: 0,
        globalSends24h: 0,
        globalLimit: 50,
      }),
    ).toEqual({ allowed: true });
  });

  it('blocks the second email inside the per-address cooldown', () => {
    expect(
      evaluateVerificationBudget({
        recentSends: 1,
        addressSends24h: 1,
        globalSends24h: 1,
        globalLimit: 50,
      }),
    ).toEqual({ allowed: false, reason: 'cooldown' });
  });

  it('blocks an address that reached its daily limit', () => {
    expect(
      evaluateVerificationBudget({
        recentSends: 0,
        addressSends24h: EMAIL_VERIFICATION_PER_ADDRESS_DAILY_LIMIT,
        globalSends24h: EMAIL_VERIFICATION_PER_ADDRESS_DAILY_LIMIT,
        globalLimit: 50,
      }),
    ).toEqual({ allowed: false, reason: 'address_limit' });
  });

  it('honours an explicit per-address limit', () => {
    expect(
      evaluateVerificationBudget({
        recentSends: 0,
        addressSends24h: 2,
        globalSends24h: 2,
        globalLimit: 50,
        perAddressLimit: 2,
      }),
    ).toEqual({ allowed: false, reason: 'address_limit' });
  });

  it('blocks every address once the global daily cap is reached', () => {
    expect(
      evaluateVerificationBudget({
        recentSends: 0,
        addressSends24h: 0,
        globalSends24h: 10,
        globalLimit: 10,
      }),
    ).toEqual({ allowed: false, reason: 'global_limit' });
  });

  it('uses a 24 hour window', () => {
    expect(EMAIL_VERIFICATION_DAILY_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});

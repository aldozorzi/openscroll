import { describe, expect, it } from 'vitest';
import {
  clearAuthCookies,
  hashPassword,
  hashSessionToken,
  setAuthCookies,
  verifyPassword,
} from './auth';
import { CSRF_COOKIE, SESSION_COOKIE } from './http';

describe('auth primitives', () => {
  it('hashes and verifies passwords with Argon2id', async () => {
    const hashed = await hashPassword('correct horse battery staple');
    expect(hashed).not.toContain('correct horse');
    await expect(
      verifyPassword(hashed, 'correct horse battery staple'),
    ).resolves.toBe(true);
    await expect(verifyPassword(hashed, 'wrong password')).resolves.toBe(false);
    await expect(verifyPassword('not-a-hash', 'anything')).resolves.toBe(false);
  });

  it('hashes session tokens deterministically without storing the token', () => {
    const token = 'session-token';
    const hash = hashSessionToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).toBe(hashSessionToken(token));
    expect(hash).not.toBe(token);
  });

  it('sets and clears session and CSRF cookies', () => {
    const response = new Response(null);
    setAuthCookies(response, { token: 'session', csrfToken: 'csrf' });
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`))).toBe(true);
    expect(cookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`))).toContain(
      'HttpOnly',
    );
    expect(cookies.find((cookie) => cookie.startsWith(`${CSRF_COOKIE}=`))).not.toContain(
      'HttpOnly',
    );

    const cleared = new Response(null);
    clearAuthCookies(cleared);
    expect(cleared.headers.getSetCookie().every((cookie) => cookie.includes('Max-Age=0'))).toBe(
      true,
    );
  });
});

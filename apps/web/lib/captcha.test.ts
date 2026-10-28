import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkRegistrationCaptcha,
  getCaptchaConfig,
  TURNSTILE_MAX_TOKEN_LENGTH,
  verifyTurnstileToken,
} from './captcha';

const keys = {
  TURNSTILE_SITE_KEY: 'site-key',
  TURNSTILE_SECRET_KEY: 'secret-key',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('captcha configuration', () => {
  it('enforces Turnstile in production when both keys are set', () => {
    const config = getCaptchaConfig({ NODE_ENV: 'production', ...keys });
    expect(config.mode).toBe('enforce');
    expect(config.siteKey).toBe('site-key');
    expect(config.configured).toBe(true);
  });

  it('makes registration unavailable in production without keys', () => {
    expect(getCaptchaConfig({ NODE_ENV: 'production' }).mode).toBe(
      'unavailable',
    );
  });

  it('treats a lone key as unconfigured', () => {
    const config = getCaptchaConfig({
      NODE_ENV: 'development',
      TURNSTILE_SITE_KEY: 'site-key',
    });
    expect(config.configured).toBe(false);
    expect(config.mode).toBe('disabled');
  });

  it('observes without blocking in development when configured', () => {
    expect(getCaptchaConfig({ NODE_ENV: 'development', ...keys }).mode).toBe(
      'observe',
    );
  });

  it('is disabled in development without keys and in tests', () => {
    expect(getCaptchaConfig({ NODE_ENV: 'development' }).mode).toBe('disabled');
    expect(getCaptchaConfig({ NODE_ENV: 'test', ...keys }).mode).toBe(
      'disabled',
    );
  });
});

describe('verifyTurnstileToken', () => {
  it('rejects missing, blank, and oversized tokens without calling the provider', async () => {
    const fetchImpl = vi.fn();
    for (const token of [undefined, '', '   ', 'x'.repeat(TURNSTILE_MAX_TOKEN_LENGTH + 1)]) {
      const result = await verifyTurnstileToken(token, {
        secretKey: 'secret',
        fetchImpl,
      });
      expect(result).toEqual({ ok: false, reason: 'missing_token' });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts the secret, token, and remote IP to siteverify', async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        jsonResponse({ success: true, action: 'register' }),
    );

    const result = await verifyTurnstileToken('token', {
      secretKey: 'secret',
      remoteIp: '203.0.113.7',
      fetchImpl,
    });

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    );
    const body = new URLSearchParams(String(init?.body));
    expect(body.get('secret')).toBe('secret');
    expect(body.get('response')).toBe('token');
    expect(body.get('remoteip')).toBe('203.0.113.7');
    expect(init?.cache).toBe('no-store');
  });

  it('rejects a token the provider marks as failed', async () => {
    const result = await verifyTurnstileToken('token', {
      secretKey: 'secret',
      fetchImpl: async () => jsonResponse({ success: false }),
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_token' });
  });

  it('rejects a token issued for another action', async () => {
    const result = await verifyTurnstileToken('token', {
      secretKey: 'secret',
      fetchImpl: async () =>
        jsonResponse({ success: true, action: 'login' }),
    });
    expect(result).toEqual({ ok: false, reason: 'action_mismatch' });
  });

  it('fails closed on provider errors, network errors, and timeouts', async () => {
    const providerError = await verifyTurnstileToken('token', {
      secretKey: 'secret',
      fetchImpl: async () => jsonResponse({}, 500),
    });
    expect(providerError).toEqual({ ok: false, reason: 'provider_error' });

    const networkError = await verifyTurnstileToken('token', {
      secretKey: 'secret',
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    expect(networkError).toEqual({ ok: false, reason: 'provider_error' });

    const timeout = await verifyTurnstileToken('token', {
      secretKey: 'secret',
      fetchImpl: async () => {
        throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
      },
    });
    expect(timeout).toEqual({ ok: false, reason: 'timeout' });
  });
});

describe('checkRegistrationCaptcha', () => {
  it('skips the provider entirely in tests', async () => {
    const fetchImpl = vi.fn();
    const decision = await checkRegistrationCaptcha(undefined, null, {
      env: { NODE_ENV: 'test', ...keys },
      fetchImpl,
    });
    expect(decision).toEqual({ action: 'allow' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blocks registration when production has no keys', async () => {
    const decision = await checkRegistrationCaptcha('token', null, {
      env: { NODE_ENV: 'production' },
    });
    expect(decision).toEqual({ action: 'unavailable' });
  });

  it('rejects an invalid token in production', async () => {
    const decision = await checkRegistrationCaptcha(undefined, '203.0.113.7', {
      env: { NODE_ENV: 'production', ...keys },
      fetchImpl: async () => jsonResponse({ success: false }),
    });
    expect(decision).toEqual({ action: 'reject', reason: 'missing_token' });
  });

  it('allows a valid token in production', async () => {
    const decision = await checkRegistrationCaptcha('token', null, {
      env: { NODE_ENV: 'production', ...keys },
      fetchImpl: async () =>
        jsonResponse({ success: true, action: 'register' }),
    });
    expect(decision).toEqual({ action: 'allow' });
  });

  it('verifies but never blocks in development', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const decision = await checkRegistrationCaptcha('bad-token', null, {
      env: { NODE_ENV: 'development', ...keys },
      fetchImpl: async () => jsonResponse({ success: false }),
    });
    expect(decision).toEqual({ action: 'allow' });
  });
});

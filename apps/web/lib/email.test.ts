import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendPasswordResetEmail, sendVerificationEmail } from './email';

describe('sendPasswordResetEmail', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends a reset link through Resend', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    vi.stubEnv('EMAIL_FROM', 'OpenScroll <security@example.com>');
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ id: 'email_123' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const sent = await sendPasswordResetEmail({
      to: 'reader@example.com',
      resetUrl: 'https://scroll.example.com/reset-password?token=abc',
      expiresInMinutes: 30,
    });

    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer re_test_key',
    );
    const body = JSON.parse(String(init.body)) as {
      from: string;
      to: string[];
      subject: string;
      html: string;
    };
    expect(body.from).toBe('OpenScroll <security@example.com>');
    expect(body.to).toEqual(['reader@example.com']);
    expect(body.subject).toContain('password');
    expect(body.html).toContain(
      'https://scroll.example.com/reset-password?token=abc',
    );
  });

  it('returns false when Resend rejects the request', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 422 })),
    );

    await expect(
      sendPasswordResetEmail({
        to: 'reader@example.com',
        resetUrl: 'https://scroll.example.com/reset-password?token=abc',
        expiresInMinutes: 30,
      }),
    ).resolves.toBe(false);
  });
});

describe('sendVerificationEmail', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('uses the dedicated verification key and sender', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_reset_key');
    vi.stubEnv('EMAIL_FROM', 'OpenScroll <reset@example.com>');
    vi.stubEnv('RESEND_VERIFICATION_API_KEY', 're_verify_key');
    vi.stubEnv('EMAIL_VERIFICATION_FROM', 'OpenScroll <verify@example.com>');
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ id: 'email_123' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const sent = await sendVerificationEmail({
      to: 'reader@example.com',
      verifyUrl: 'https://scroll.example.com/verify-email?token=abc',
      expiresInHours: 24,
    });

    expect(sent).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer re_verify_key',
    );
    const body = JSON.parse(String(init.body)) as {
      from: string;
      to: string[];
      subject: string;
      text: string;
      html: string;
    };
    expect(body.from).toBe('OpenScroll <verify@example.com>');
    expect(body.to).toEqual(['reader@example.com']);
    expect(body.subject).toContain('Verify');
    expect(body.text).toContain(
      'https://scroll.example.com/verify-email?token=abc',
    );
    expect(body.html).toContain(
      'https://scroll.example.com/verify-email?token=abc',
    );
  });

  it('falls back to the reset credentials when no verification key exists', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_reset_key');
    vi.stubEnv('EMAIL_FROM', 'OpenScroll <reset@example.com>');
    vi.stubEnv('RESEND_VERIFICATION_API_KEY', undefined);
    vi.stubEnv('EMAIL_VERIFICATION_FROM', undefined);
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ id: 'email_123' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const sent = await sendVerificationEmail({
      to: 'reader@example.com',
      verifyUrl: 'https://scroll.example.com/verify-email?token=abc',
      expiresInHours: 24,
    });

    expect(sent).toBe(true);
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer re_reset_key',
    );
    const body = JSON.parse(String(init.body)) as { from: string };
    expect(body.from).toBe('OpenScroll <reset@example.com>');
  });

  it('returns false when Resend rejects the verification email', async () => {
    vi.stubEnv('RESEND_VERIFICATION_API_KEY', 're_verify_key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 422 })),
    );

    await expect(
      sendVerificationEmail({
        to: 'reader@example.com',
        verifyUrl: 'https://scroll.example.com/verify-email?token=abc',
        expiresInHours: 24,
      }),
    ).resolves.toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, securityHeaders } from './security-headers';

describe('security headers', () => {
  it('uses a nonce-based script policy without unsafe-inline in production', () => {
    const policy = contentSecurityPolicy({ nonce: 'test-nonce' });
    expect(policy).toContain("'nonce-test-nonce'");
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toContain('upgrade-insecure-requests');
  });

  it('allows Next.js development tooling in development only', () => {
    const policy = contentSecurityPolicy({ nonce: 'dev', isDevelopment: true });
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("'unsafe-inline'");
  });

  it('allows the Turnstile script and frame origins', () => {
    const policy = contentSecurityPolicy({ nonce: 'test-nonce' });
    expect(policy).toContain('script-src');
    expect(policy).toContain('https://challenges.cloudflare.com');
    expect(policy).toContain(
      'connect-src \'self\' https://challenges.cloudflare.com',
    );
    expect(policy).toContain(
      'frame-src https://challenges.cloudflare.com',
    );
    expect(policy).not.toContain('frame-src *');
  });

  it('only sets HSTS and upgrades requests for HTTPS', () => {
    expect(securityHeaders({ nonce: 'x' })['strict-transport-security']).toBeUndefined();
    expect(contentSecurityPolicy({ nonce: 'x' })).not.toContain(
      'upgrade-insecure-requests',
    );
    expect(
      securityHeaders({ nonce: 'x', isHttps: true })['strict-transport-security'],
    ).toContain('max-age=63072000');
    expect(contentSecurityPolicy({ nonce: 'x', isHttps: true })).toContain(
      'upgrade-insecure-requests',
    );
  });

  it('sets baseline browser hardening headers', () => {
    const headers = securityHeaders();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
  });
});

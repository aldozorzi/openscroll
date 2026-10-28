import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// Rate limiting intentionally ignores spoofable forwarded headers unless a
// trusted proxy is configured. Tests exercise the trusted-proxy path.
process.env.TRUST_PROXY = 'true';
import {
  appendCookie,
  assertCsrf,
  assertSameOrigin,
  CSRF_COOKIE,
  CSRF_HEADER,
  getClientIp,
  getCookie,
  handleRoute,
  HttpError,
  parseJson,
} from './http';

function request(
  path = 'http://localhost:3000/api/v1/test',
  init: RequestInit = {},
): Request {
  return new Request(path, init);
}

describe('HTTP helpers', () => {
  it('reads cookies and rejects oversized or malformed IP headers', () => {
    const req = request('http://localhost:3000/', {
      headers: {
        cookie: 'a=1; openscroll_session=token%20value',
        'x-forwarded-for': '203.0.113.9, 10.0.0.1',
      },
    });
    expect(getCookie(req, 'openscroll_session')).toBe('token value');
    expect(getCookie(req, 'missing')).toBeNull();
    expect(getClientIp(req)).toBe('203.0.113.9');

    const invalidIp = request('http://localhost:3000/', {
      headers: { 'x-forwarded-for': 'not-an-ip' },
    });
    expect(getClientIp(invalidIp)).toBeNull();
  });

  it('enforces double-submit CSRF only for state-changing requests', () => {
    const read = request('http://localhost:3000/', { method: 'GET' });
    expect(() => assertCsrf(read)).not.toThrow();

    const missing = request('http://localhost:3000/', { method: 'POST' });
    expect(() => assertCsrf(missing)).toThrow(HttpError);

    const valid = request('http://localhost:3000/', {
      method: 'POST',
      headers: {
        cookie: `${CSRF_COOKIE}=abc`,
        [CSRF_HEADER]: 'abc',
      },
    });
    expect(() => assertCsrf(valid)).not.toThrow();

    const mismatch = request('http://localhost:3000/', {
      method: 'POST',
      headers: {
        cookie: `${CSRF_COOKIE}=abc`,
        [CSRF_HEADER]: 'xyz',
      },
    });
    expect(() => assertCsrf(mismatch)).toThrow(HttpError);
  });

  it('checks Origin against the request and configured app origin', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
    expect(() =>
      assertSameOrigin(
        request('http://localhost:3000/', {
          headers: { origin: 'http://localhost:3000' },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertSameOrigin(
        request('http://localhost:3000/', {
          headers: { origin: 'https://app.example.com' },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertSameOrigin(
        request('http://localhost:3000/', {
          headers: { origin: 'https://evil.example.com' },
        }),
      ),
    ).toThrow(HttpError);
  });

  it('accepts an Origin matching the request Host header', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    const req = request('http://localhost:3100/api/v1/auth/register', {
      method: 'POST',
      headers: {
        origin: 'http://127.0.0.1:3100',
        host: '127.0.0.1:3100',
      },
    });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it('parses JSON and converts validation failures to API errors', async () => {
    const schema = z.object({ name: z.string().min(2) });
    await expect(
      parseJson(
        request('http://localhost:3000/', {
          method: 'POST',
          body: JSON.stringify({ name: 'x' }),
        }),
        schema,
      ),
    ).rejects.toThrow(z.ZodError);

    await expect(
      parseJson(
        request('http://localhost:3000/', {
          method: 'POST',
          body: 'not json',
        }),
        schema,
      ),
    ).rejects.toMatchObject({ status: 400 });

    const response = await handleRoute(
      request('http://localhost:3000/', { method: 'POST', body: 'not json' }),
      async (meta) => {
        await parseJson(
          request('http://localhost:3000/', {
            method: 'POST',
            body: JSON.stringify({ name: 'x' }),
          }),
          schema,
        );
        return new Response(meta.requestId);
      },
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('x-request-id')).toMatch(/^req_/);
    const body = (await response.json()) as {
      error: { code: string; requestId: string };
    };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('sets HttpOnly session cookies but keeps the CSRF cookie readable', () => {
    const response = new Response(null);
    appendCookie(response, 'session', 'abc', { httpOnly: true });
    appendCookie(response, 'csrf', 'def', { httpOnly: false });
    const headers = response.headers.getSetCookie();
    expect(headers[0]).toContain('session=abc');
    expect(headers[0]).toContain('HttpOnly');
    expect(headers[1]).toContain('csrf=def');
    expect(headers[1]).not.toContain('HttpOnly');
  });
});

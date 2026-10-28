import { describe, expect, it, vi } from 'vitest';
import {
  assertPublicHttpUrl,
  isPublicIp,
  safeFetch,
  SsrfError,
  type ResolvedAddress,
} from './ssrf';

const publicAddresses: ResolvedAddress[] = [
  { address: '93.184.216.34', family: 4 },
];

describe('IP classification', () => {
  it('allows public addresses', () => {
    expect(isPublicIp('8.8.8.8')).toBe(true);
    expect(isPublicIp('2606:4700:4700::1111')).toBe(true);
  });

  it('blocks loopback, private, link-local, metadata, multicast, and mapped addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      'fc00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isPublicIp(address), address).toBe(false);
    }
  });
});

describe('assertPublicHttpUrl', () => {
  it('rejects private destinations', async () => {
    await expect(
      assertPublicHttpUrl('http://127.0.0.1/', async () => [
        { address: '127.0.0.1', family: 4 },
      ]),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects credentials and non-http schemes', async () => {
    await expect(
      assertPublicHttpUrl('https://user:pass@example.com/', async () => publicAddresses),
    ).rejects.toBeInstanceOf(SsrfError);
    await expect(
      assertPublicHttpUrl('file:///etc/passwd', async () => publicAddresses),
    ).rejects.toBeInstanceOf(SsrfError);
  });
});

describe('safeFetch', () => {
  it('disables automatic redirects and re-checks the destination', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      }),
    );

    await expect(
      safeFetch('https://example.com/', {
        fetchImpl,
        resolveHost: async (hostname) =>
          hostname === 'example.com'
            ? publicAddresses
            : [{ address: '169.254.169.254', family: 4 }],
      }),
    ).rejects.toBeInstanceOf(SsrfError);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('enforces the response size cap', async () => {
    const fetchImpl = async () =>
      new Response('x'.repeat(128), {
        headers: { 'content-type': 'text/plain' },
      });

    await expect(
      safeFetch('https://example.com/file', {
        fetchImpl,
        maxBytes: 16,
        resolveHost: async () => publicAddresses,
      }),
    ).rejects.toMatchObject({ code: 'MAX_BYTES' });
  });

  it('rejects unexpected content types', async () => {
    const fetchImpl = async () =>
      new Response('<html></html>', {
        headers: { 'content-type': 'text/html' },
      });

    await expect(
      safeFetch('https://example.com/feed', {
        fetchImpl,
        allowedContentTypes: ['application/rss+xml'],
        resolveHost: async () => publicAddresses,
      }),
    ).rejects.toMatchObject({ code: 'CONTENT_TYPE' });
  });

  it('returns parsed text and JSON bodies', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      });

    const response = await safeFetch('https://example.com/api', {
      fetchImpl,
      resolveHost: async () => publicAddresses,
    });

    expect(response.json<{ ok: boolean }>()).toEqual({ ok: true });
    expect(response.text()).toBe('{"ok":true}');
  });
});

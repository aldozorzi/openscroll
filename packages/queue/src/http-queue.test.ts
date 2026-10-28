import { describe, expect, it } from 'vitest';
import {
  createInngestQueue,
  createQStashQueue,
  isValidJobPayload,
  type InngestQueueOptions,
  type QStashQueueOptions,
} from './http-queue';

const webhookUrl = 'https://worker.example.com/jobs';
const webhookSecret = 'queue-secret-0123456789abcdef012345';
const sourceId = '00000000-0000-4000-8000-000000000001';

function fakeFetch(
  calls: Array<{ url: string; init: RequestInit }>,
  body: Record<string, unknown> = { messageId: 'msg_1', ids: ['event_1'] },
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('QStash queue adapter', () => {
  it('publishes jobs with forwarding, deduplication, delay, and retries', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const options: QStashQueueOptions = {
      token: 'qstash-token',
      webhookUrl,
      webhookSecret,
      fetchImpl: fakeFetch(calls),
    };
    const queue = createQStashQueue(options);
    await queue.start();

    const id = await queue.enqueue(
      'ingest-source',
      { sourceId },
      {
        singletonKey: `source:${sourceId}`,
        retryLimit: 2,
        startAfter: new Date(Date.now() + 60_000),
      },
    );

    expect(id).toBe('msg_1');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://qstash.upstash.io/v2/publish/${webhookUrl}`);
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('authorization')).toBe('Bearer qstash-token');
    expect(headers.get('upstash-forward-x-openscroll-queue-secret')).toBe(webhookSecret);
    expect(headers.get('upstash-retries')).toBe('2');
    expect(headers.get('upstash-deduplication-id')).toMatch(/^[a-f0-9]{64}$/u);
    expect(headers.get('upstash-delay')).toMatch(/^6[01]s$/u);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      name: 'ingest-source',
      data: { sourceId },
    });
  });

  it('rejects weak webhook secrets', async () => {
    const queue = createQStashQueue({
      token: 'qstash-token',
      webhookUrl,
      webhookSecret: 'short',
      fetchImpl: fakeFetch([]),
    });
    await expect(queue.start()).rejects.toThrow('at least 32 characters');
  });
});

describe('webhook job payload validation', () => {
  it('accepts known jobs with valid payloads', () => {
    expect(isValidJobPayload('ingest-source', { sourceId })).toBe(true);
    expect(isValidJobPayload('process-article', { articleId: sourceId })).toBe(
      true,
    );
    expect(isValidJobPayload('generate-card', { articleId: sourceId })).toBe(
      true,
    );
    expect(isValidJobPayload('recompute-user-vector', { userId: sourceId })).toBe(
      true,
    );
    expect(isValidJobPayload('retention-cleanup', {})).toBe(true);
    expect(
      isValidJobPayload('retention-cleanup', {
        requestedAt: new Date().toISOString(),
      }),
    ).toBe(true);
  });

  it('rejects unknown jobs and malformed payloads', () => {
    expect(isValidJobPayload('unknown-job', { sourceId })).toBe(false);
    expect(isValidJobPayload('ingest-source', {})).toBe(false);
    expect(isValidJobPayload('ingest-source', { sourceId: 'not-a-uuid' })).toBe(
      false,
    );
    expect(isValidJobPayload('ingest-source', null)).toBe(false);
    expect(isValidJobPayload('process-article', { sourceId })).toBe(false);
    expect(
      isValidJobPayload('retention-cleanup', { requestedAt: 'not-a-date' }),
    ).toBe(false);
  });
});

describe('Inngest queue adapter', () => {
  it('publishes an event without embedding the webhook secret', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const options: InngestQueueOptions = {
      eventKey: 'event-key',
      eventName: 'openscroll/job',
      webhookUrl,
      webhookSecret,
      fetchImpl: fakeFetch(calls),
    };
    const queue = createInngestQueue(options);
    await queue.start();

    const id = await queue.enqueue(
      'generate-card',
      { articleId: sourceId },
      { singletonKey: `article:${sourceId}` },
    );

    expect(id).toBe('event_1');
    expect(calls[0]?.url).toBe('https://inn.gs/e/event-key');
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      name: string;
      id: string;
      data: Record<string, unknown>;
    };
    expect(body.name).toBe('openscroll/job');
    expect(body.id).toMatch(/^[a-f0-9]{64}$/u);
    expect(body.data).toEqual({
      job: { name: 'generate-card', data: { articleId: sourceId } },
      webhook_url: webhookUrl,
    });
    expect(JSON.stringify(body)).not.toContain(webhookSecret);
  });
});

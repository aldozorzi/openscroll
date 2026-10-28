import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type {
  EnqueueOptions,
  JobHandler,
  QueueAdapter,
  QueueJob,
  QueueStats,
  WorkOptions,
} from './adapter';
import { PermanentJobError } from './adapter';
import type { JobName, JobPayloadMap } from './jobs';

const SECRET_HEADER = 'x-openscroll-queue-secret';
const MAX_BODY_BYTES = 1_048_576;
const JOB_NAMES = new Set<string>([
  'ingest-source',
  'process-article',
  'generate-card',
  'retention-cleanup',
  'recompute-user-vector',
]);

function idFor(singletonKey: string | undefined): string | undefined {
  return singletonKey
    ? createHash('sha256').update(singletonKey).digest('hex')
    : undefined;
}

function secretMatches(supplied: string | undefined, expected: string): boolean {
  if (!supplied) {
    return false;
  }
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readJson(request: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error('Request body exceeds 1 MB');
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as unknown) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isIsoTimestamp(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length <= 64 &&
    !Number.isNaN(Date.parse(value))
  );
}

/**
 * The webhook is an externally reachable endpoint. Validate the payload shape
 * per job before handing data to a worker handler; the TypeScript types alone
 * provide no runtime guarantee.
 */
const JOB_PAYLOAD_VALIDATORS: Record<
  JobName,
  (data: Record<string, unknown>) => boolean
> = {
  'ingest-source': (data) => isUuid(data.sourceId),
  'process-article': (data) => isUuid(data.articleId),
  'generate-card': (data) => isUuid(data.articleId),
  'retention-cleanup': (data) =>
    data.requestedAt === undefined || isIsoTimestamp(data.requestedAt),
  'recompute-user-vector': (data) => isUuid(data.userId),
};

export function isValidJobPayload(name: string, data: unknown): boolean {
  return (
    JOB_NAMES.has(name) &&
    isRecord(data) &&
    JOB_PAYLOAD_VALIDATORS[name as JobName](data)
  );
}

export interface WebhookQueueOptions {
  webhookUrl: string;
  webhookSecret: string;
  host?: string;
  port?: number;
  fetchImpl?: typeof fetch;
}

export abstract class WebhookQueueAdapter implements QueueAdapter {
  protected readonly webhookUrl: string;
  protected readonly secret: string;
  protected readonly fetchImpl: typeof fetch;
  private readonly host: string;
  private readonly port: number;
  private readonly handlers = new Map<string, JobHandler<JobName>>();
  private server: Server | null = null;
  private serverPromise: Promise<void> | null = null;
  protected started = false;

  protected constructor(options: WebhookQueueOptions) {
    this.webhookUrl = options.webhookUrl;
    this.secret = options.webhookSecret;
    this.host = options.host ?? '0.0.0.0';
    this.port = options.port ?? 3101;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async start(): Promise<void> {
    if (!this.secret || this.secret.length < 32) {
      throw new Error('QUEUE_WEBHOOK_SECRET must be at least 32 characters');
    }
    new URL(this.webhookUrl);
    this.started = true;
  }

  async stop(): Promise<void> {
    this.handlers.clear();
    await this.closeServer();
    this.started = false;
  }

  private async closeServer(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.serverPromise = null;
    if (!server) {
      return;
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private ensureServer(): Promise<void> {
    if (this.serverPromise) {
      return this.serverPromise;
    }
    this.serverPromise = new Promise<void>((resolve, reject) => {
      const server = createServer((request, response) => {
        void this.handleRequest(request, response);
      });
      server.once('error', reject);
      server.listen(this.port, this.host, () => {
        server.off('error', reject);
        this.server = server;
        resolve();
      });
    });
    return this.serverPromise;
  }

  private async handleRequest(
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
  ): Promise<void> {
    const send = (status: number, body: Record<string, unknown>) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };

    if (request.method !== 'POST') {
      send(405, { error: 'Method not allowed' });
      return;
    }
    if (!secretMatches(request.headers[SECRET_HEADER] as string | undefined, this.secret)) {
      send(401, { error: 'Invalid queue secret' });
      return;
    }

    let payload: unknown;
    try {
      payload = await readJson(request);
    } catch (error) {
      send(400, {
        error: error instanceof Error ? error.message : 'Invalid JSON',
      });
      return;
    }

    if (
      !isRecord(payload) ||
      typeof payload.name !== 'string' ||
      (payload.id !== undefined &&
        (typeof payload.id !== 'string' || payload.id.length > 255)) ||
      !isValidJobPayload(payload.name, payload.data)
    ) {
      send(400, { error: 'Invalid job payload' });
      return;
    }

    const name = payload.name as JobName;
    const handler = this.handlers.get(name);
    if (!handler) {
      send(404, { error: 'No handler registered for job' });
      return;
    }

    const envelope: QueueJob<JobName> = {
      id: typeof payload.id === 'string' ? payload.id : crypto.randomUUID(),
      name,
      data: payload.data as JobPayloadMap[JobName],
      retryCount: 0,
      signal: AbortSignal.timeout(15 * 60_000),
    };

    try {
      await handler(envelope);
      send(200, { ok: true });
    } catch (error) {
      if (error instanceof PermanentJobError) {
        send(200, { ok: false, permanent: true });
        return;
      }
      send(500, {
        error: error instanceof Error ? error.message : 'Job failed',
      });
    }
  }

  async enqueue<N extends JobName>(
    name: N,
    data: JobPayloadMap[N],
    options?: EnqueueOptions,
  ): Promise<string | null> {
    return this.publish(name, data, options);
  }

  protected abstract publish<N extends JobName>(
    name: N,
    data: JobPayloadMap[N],
    options?: EnqueueOptions,
  ): Promise<string | null>;

  async work<N extends JobName>(
    name: N,
    handler: JobHandler<N>,
    _options?: WorkOptions,
  ): Promise<string> {
    this.handlers.set(name, handler as JobHandler<JobName>);
    await this.ensureServer();
    return name;
  }

  async offWork(name: JobName): Promise<void> {
    this.handlers.delete(name);
    if (this.handlers.size === 0) {
      await this.closeServer();
    }
  }

  async schedule<N extends JobName>(
    _name: N,
    _cron: string,
    _data: JobPayloadMap[N],
    _options?: EnqueueOptions & { key?: string; timezone?: string },
  ): Promise<void> {
    throw new Error('This queue driver does not support adapter-managed schedules');
  }

  async unschedule(_name: JobName, _key?: string): Promise<void> {
    throw new Error('This queue driver does not support adapter-managed schedules');
  }

  async getQueueStats(_name: JobName | string): Promise<QueueStats | null> {
    return null;
  }

  async pendingJobCount(_names: readonly JobName[]): Promise<number> {
    return 0;
  }
}

export interface QStashQueueOptions extends WebhookQueueOptions {
  token: string;
  apiUrl?: string;
}

export class QStashQueueAdapter extends WebhookQueueAdapter {
  private readonly token: string;
  private readonly apiUrl: string;
  private readonly schedules = new Map<string, string>();

  constructor(options: QStashQueueOptions) {
    super(options);
    this.token = options.token;
    this.apiUrl = (options.apiUrl ?? 'https://qstash.upstash.io').replace(/\/$/u, '');
  }

  protected async publish<N extends JobName>(
    name: N,
    data: JobPayloadMap[N],
    options?: EnqueueOptions,
  ): Promise<string | null> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      'content-type': 'application/json',
      [`Upstash-Forward-${SECRET_HEADER}`]: this.secret,
      'Upstash-Retries': String(options?.retryLimit ?? 3),
    };
    const deduplicationId = idFor(options?.singletonKey);
    if (deduplicationId) {
      headers['Upstash-Deduplication-Id'] = deduplicationId;
    }
    if (options?.startAfter !== undefined) {
      const target =
        options.startAfter instanceof Date
          ? options.startAfter
          : new Date(options.startAfter);
      const delaySeconds = Math.max(
        0,
        Math.ceil((target.getTime() - Date.now()) / 1_000),
      );
      if (delaySeconds > 0) {
        headers['Upstash-Delay'] = `${delaySeconds}s`;
      }
    }

    const response = await this.fetchImpl(
      `${this.apiUrl}/v2/publish/${this.webhookUrl}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, data }),
      },
    );
    if (!response.ok) {
      throw new Error(`QStash publish failed with status ${response.status}`);
    }
    const body = (await response.json()) as { messageId?: string };
    return body.messageId ?? null;
  }

  override async schedule<N extends JobName>(
    name: N,
    cron: string,
    data: JobPayloadMap[N],
    options?: EnqueueOptions & { key?: string; timezone?: string },
  ): Promise<void> {
    const key = options?.key ?? name;
    const response = await this.fetchImpl(
      `${this.apiUrl}/v2/schedules/${this.webhookUrl}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
          [`Upstash-Forward-${SECRET_HEADER}`]: this.secret,
          'Upstash-Cron': cron,
        },
        body: JSON.stringify({ name, data }),
      },
    );
    if (!response.ok) {
      throw new Error(`QStash schedule failed with status ${response.status}`);
    }
    const body = (await response.json()) as { scheduleId?: string };
    if (body.scheduleId) {
      this.schedules.set(key, body.scheduleId);
    }
  }

  override async unschedule(name: JobName, key?: string): Promise<void> {
    const scheduleId = this.schedules.get(key ?? name);
    if (!scheduleId) {
      return;
    }
    const response = await this.fetchImpl(
      `${this.apiUrl}/v2/schedules/${scheduleId}`,
      {
        method: 'DELETE',
        headers: { authorization: `Bearer ${this.token}` },
      },
    );
    if (!response.ok) {
      throw new Error(`QStash unschedule failed with status ${response.status}`);
    }
    this.schedules.delete(key ?? name);
  }
}

export interface InngestQueueOptions extends WebhookQueueOptions {
  eventKey: string;
  eventName?: string;
  apiUrl?: string;
}

export class InngestQueueAdapter extends WebhookQueueAdapter {
  private readonly eventKey: string;
  private readonly eventName: string;
  private readonly apiUrl: string;

  constructor(options: InngestQueueOptions) {
    super(options);
    this.eventKey = options.eventKey;
    this.eventName = options.eventName ?? 'openscroll/job';
    this.apiUrl = (options.apiUrl ?? 'https://inn.gs/e').replace(/\/$/u, '');
  }

  protected async publish<N extends JobName>(
    name: N,
    data: JobPayloadMap[N],
    options?: EnqueueOptions,
  ): Promise<string | null> {
    const response = await this.fetchImpl(
      `${this.apiUrl}/${this.eventKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: this.eventName,
          data: {
            job: { name, data },
            webhook_url: this.webhookUrl,
          },
          ...(options?.singletonKey
            ? { id: idFor(options.singletonKey) }
            : {}),
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Inngest publish failed with status ${response.status}`);
    }
    const body = (await response.json()) as { ids?: string[] };
    return body.ids?.[0] ?? null;
  }

  override async schedule<N extends JobName>(
    _name: N,
    _cron: string,
    _data: JobPayloadMap[N],
    _options?: EnqueueOptions & { key?: string; timezone?: string },
  ): Promise<void> {
    throw new Error(
      'Inngest schedules are configured with Inngest cron functions; use pg-boss or BullMQ for adapter-managed schedules',
    );
  }
}

export function createQStashQueue(options: QStashQueueOptions): QueueAdapter {
  return new QStashQueueAdapter(options);
}

export function createInngestQueue(options: InngestQueueOptions): QueueAdapter {
  return new InngestQueueAdapter(options);
}

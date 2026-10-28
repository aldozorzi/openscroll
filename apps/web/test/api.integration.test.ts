import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  articles,
  cards,
  passwordResetTokens,
  sources,
  userSources,
  users,
  type Database,
} from '@openscroll/db';
import { hashUrl } from '@openscroll/ingest';
import {
  createPasswordResetToken,
  PASSWORD_RESET_TTL_MS,
} from '../lib/auth';
import { getDb, closeDbForTests } from '../lib/db';
import { closeQueueForTests } from '../lib/queue';
import { clearFeedCacheForTests } from '../lib/feed';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '../lib/http';
import { resetRateLimitsForTests } from '../lib/rate-limit';
import { upsertSource } from '../lib/sources';
import * as registerRoute from '../app/api/v1/auth/register/route';
import * as verifyEmailRoute from '../app/api/v1/auth/verify-email/route';
import * as resendVerificationRoute from '../app/api/v1/auth/resend-verification/route';
import * as loginRoute from '../app/api/v1/auth/login/route';
import * as forgotPasswordRoute from '../app/api/v1/auth/forgot-password/route';
import * as resetPasswordRoute from '../app/api/v1/auth/reset-password/route';
import * as refreshRoute from '../app/api/v1/auth/refresh/route';
import * as logoutRoute from '../app/api/v1/auth/logout/route';
import * as meRoute from '../app/api/v1/me/route';
import * as preferencesRoute from '../app/api/v1/user/preferences/route';
import * as feedRoute from '../app/api/v1/feed/route';
import * as cardRoute from '../app/api/v1/cards/[id]/route';
import * as interactionRoute from '../app/api/v1/cards/[id]/interaction/route';
import * as reviewRoute from '../app/api/v1/cards/[id]/review/route';
import * as savedRoute from '../app/api/v1/me/saved/route';
import * as exportRoute from '../app/api/v1/me/export/route';
import * as sourcesRoute from '../app/api/v1/sources/route';
import * as sourceRoute from '../app/api/v1/sources/[id]/route';
import * as sourceStatusRoute from '../app/api/v1/sources/[id]/status/route';
import * as subscribeRoute from '../app/api/v1/sources/[id]/subscribe/route';
import * as opmlRoute from '../app/api/v1/sources/import/opml/route';
import * as healthRoute from '../app/api/v1/health/route';
import * as usageRoute from '../app/api/v1/admin/usage/route';
import * as adminSourcesRoute from '../app/api/v1/admin/sources/route';
import * as ingestRoute from '../app/api/v1/admin/ingest/route';
import * as reembedRoute from '../app/api/v1/admin/reembed/route';
import * as adminQueueRoute from '../app/api/v1/admin/queue/route';
import * as takedownRoute from '../app/api/v1/admin/takedown/route';
import * as openApiRoute from '../app/api/v1/openapi/route';

const emailMock = vi.hoisted(() => ({
  reset: [] as Array<{
    to: string;
    resetUrl: string;
    expiresInMinutes: number;
  }>,
  verification: [] as Array<{
    to: string;
    verifyUrl: string;
    expiresInHours: number;
  }>,
}));

vi.mock('../lib/email', () => ({
  sendPasswordResetEmail: vi.fn(
    async (input: { to: string; resetUrl: string; expiresInMinutes: number }) => {
      emailMock.reset.push(input);
      return true;
    },
  ),
  sendVerificationEmail: vi.fn(
    async (input: { to: string; verifyUrl: string; expiresInHours: number }) => {
      emailMock.verification.push(input);
      return true;
    },
  ),
}));

const runDatabaseTests = process.env.RUN_WORKER_DB_TESTS === '1';
const origin = 'http://localhost:3000';
const adminToken = 'test-admin-token-0123456789abcdef';

interface AuthCookies {
  cookie: string;
  csrf: string;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

function request(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookies?: AuthCookies;
    csrf?: boolean;
    idempotency?: string;
    token?: string;
  } = {},
): Request {
  const headers = new Headers({ origin });
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
  }
  if (options.cookies) {
    headers.set('cookie', options.cookies.cookie);
  }
  if (options.csrf !== false && options.cookies) {
    headers.set(CSRF_HEADER, options.cookies.csrf);
  }
  if (options.idempotency) {
    headers.set('idempotency-key', options.idempotency);
  }
  if (options.token) {
    headers.set('authorization', `Bearer ${options.token}`);
  }
  return new Request(`${origin}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

function authCookies(response: Response): AuthCookies {
  const values = new Map<string, string>();
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const separator = pair?.indexOf('=') ?? -1;
    if (!pair || separator < 0) {
      continue;
    }
    values.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  const session = values.get(SESSION_COOKIE);
  const csrf = values.get(CSRF_COOKIE);
  if (!session || !csrf) {
    throw new Error('Authentication cookies were not set');
  }
  return {
    cookie: `${SESSION_COOKIE}=${session}; ${CSRF_COOKIE}=${csrf}`,
    csrf,
  };
}

function context(id: string): RouteContext {
  return { params: Promise.resolve({ id }) };
}

function verificationTokenFromUrl(verifyUrl: string): string {
  const url = new URL(verifyUrl);
  expect(url.pathname).toBe('/verify-email');
  const token = url.searchParams.get('token');
  if (!token) {
    throw new Error('Verification email did not contain a token');
  }
  return token;
}

async function registerUnverifiedAccount(
  accountEmail: string,
  accountPassword: string,
): Promise<void> {
  resetRateLimitsForTests();
  emailMock.verification.length = 0;

  const registered = await registerRoute.POST(
    request('/api/v1/auth/register', {
      method: 'POST',
      body: { email: accountEmail, password: accountPassword },
    }),
  );
  expect(registered.status).toBe(202);
  expect(await registered.json()).toEqual({ ok: true });
  // Registration must never hand out a session before the address is proven.
  expect(registered.headers.get('set-cookie')).toBeNull();

  await vi.waitFor(
    () => expect(emailMock.verification).toHaveLength(1),
    { timeout: 5_000 },
  );
  expect(emailMock.verification[0]?.to).toBe(accountEmail);
}

async function registerVerifiedAccount(
  accountEmail: string,
  accountPassword: string,
): Promise<{ userId: string; cookies: AuthCookies }> {
  await registerUnverifiedAccount(accountEmail, accountPassword);
  const token = verificationTokenFromUrl(
    emailMock.verification[0]!.verifyUrl,
  );

  const verified = await verifyEmailRoute.POST(
    request('/api/v1/auth/verify-email', {
      method: 'POST',
      body: { token, password: accountPassword },
    }),
  );
  expect(verified.status).toBe(200);
  const body = (await verified.json()) as { user: { id: string } };
  emailMock.verification.length = 0;
  return { userId: body.user.id, cookies: authCookies(verified) };
}


function unitEmbedding(): number[] {
  return Array.from({ length: 1024 }, (_value, index) => (index === 0 ? 1 : 0));
}

describe.skipIf(!runDatabaseTests)('API integration', () => {
  let db: Database;
  let userId: string;
  let outsiderId: string | null = null;
  let outsiderEmail: string | null = null;
  let cookies: AuthCookies;
  let sourceId: string;
  let cardId: string;
  const email = `api-${randomUUID()}@example.com`;
  const password = 'correct horse battery staple';
  const newPassword = 'new correct horse battery staple';

  beforeAll(() => {
    Object.assign(process.env, { NODE_ENV: 'test' });
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      'postgresql://openscroll:openscroll@localhost:5432/openscroll';
    process.env.DIRECT_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
    process.env.ADMIN_TOKEN = adminToken;
    process.env.NEXT_PUBLIC_APP_URL = origin;
    process.env.LLM_PROVIDER = 'mock';
    process.env.EMBEDDING_PROVIDER = 'mock';

    db = getDb();
  });

  afterAll(async () => {
    await clearFeedCacheForTests();
    await closeQueueForTests();
    if (db && userId) {
      await db.delete(users).where(eq(users.id, userId));
    }
    if (db && outsiderId) {
      await db.delete(users).where(eq(users.id, outsiderId));
    }
    await closeDbForTests();
  });

  it('registers without a session, blocks unverified login, then verifies the email', async () => {
    resetRateLimitsForTests();
    emailMock.verification.length = 0;

    const weak = await registerRoute.POST(
      request('/api/v1/auth/register', {
        method: 'POST',
        body: { email: `weak-${randomUUID()}@example.com`, password: 'short' },
      }),
    );
    expect(weak.status).toBe(400);

    const response = await registerRoute.POST(
      request('/api/v1/auth/register', {
        method: 'POST',
        body: { email, password },
      }),
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('set-cookie')).toBeNull();

    // The row exists but the account is not usable until the link is consumed.
    const [created] = await db
      .select({ id: users.id, emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.email, email));
    expect(created?.emailVerifiedAt).toBeNull();
    userId = created!.id;

    await vi.waitFor(
      () => expect(emailMock.verification).toHaveLength(1),
      { timeout: 5_000 },
    );
    expect(emailMock.verification[0]?.to).toBe(email);
    expect(emailMock.verification[0]?.expiresInHours).toBe(24);
    const token = verificationTokenFromUrl(
      emailMock.verification[0]!.verifyUrl,
    );

    // Correct password on an unverified address gets the same generic 401 as
    // a wrong password, with no session. A distinct response would let an
    // attacker register a chosen password and probe whether the address was
    // already verified.
    const blocked = await loginRoute.POST(
      request('/api/v1/auth/login', {
        method: 'POST',
        body: { email, password },
      }),
    );
    expect(blocked.status).toBe(401);
    expect(await blocked.json()).toMatchObject({
      error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' },
    });
    expect(blocked.headers.get('set-cookie')).toBeNull();

    // A victim who clicks an unsolicited link cannot activate a password they
    // do not know, and the failed attempt must not consume the token.
    const wrongVerificationPassword = await verifyEmailRoute.POST(
      request('/api/v1/auth/verify-email', {
        method: 'POST',
        body: { token, password: 'attacker chosen password' },
      }),
    );
    expect(wrongVerificationPassword.status).toBe(400);

    const verified = await verifyEmailRoute.POST(
      request('/api/v1/auth/verify-email', {
        method: 'POST',
        body: { token, password },
      }),
    );
    expect(verified.status).toBe(200);
    const verifiedBody = (await verified.json()) as {
      user: { id: string; email: string };
    };
    expect(verifiedBody.user.id).toBe(userId);
    expect(verifiedBody.user.email).toBe(email);
    cookies = authCookies(verified);

    // Verification tokens are single-use.
    const reuse = await verifyEmailRoute.POST(
      request('/api/v1/auth/verify-email', {
        method: 'POST',
        body: { token, password },
      }),
    );
    expect(reuse.status).toBe(400);

    // Registering an address that is already verified is a no-op and still
    // looks identical to a fresh registration.
    emailMock.verification.length = 0;
    const duplicate = await registerRoute.POST(
      request('/api/v1/auth/register', {
        method: 'POST',
        body: { email: email.toUpperCase(), password },
      }),
    );
    expect(duplicate.status).toBe(202);
    expect(await duplicate.json()).toEqual({ ok: true });
    expect(duplicate.headers.get('set-cookie')).toBeNull();

    const wrongPassword = await registerRoute.POST(
      request('/api/v1/auth/register', {
        method: 'POST',
        body: { email, password: 'definitely the wrong password' },
      }),
    );
    expect(wrongPassword.status).toBe(202);
    expect(await wrongPassword.json()).toEqual({ ok: true });
    // No mail is sent for an already-verified address.
    expect(emailMock.verification).toHaveLength(0);

    const unauthenticated = await meRoute.GET(
      request('/api/v1/me'),
    );
    expect(unauthenticated.status).toBe(401);

    const profile = await meRoute.GET(
      request('/api/v1/me', { cookies }),
    );
    expect(profile.status).toBe(200);
  });

  it('answers resend requests uniformly and enforces the verification cooldown', async () => {
    resetRateLimitsForTests();
    emailMock.verification.length = 0;

    const pendingEmail = `pending-${randomUUID()}@example.com`;
    const registered = await registerRoute.POST(
      request('/api/v1/auth/register', {
        method: 'POST',
        body: { email: pendingEmail, password },
      }),
    );
    expect(registered.status).toBe(202);
    await vi.waitFor(
      () => expect(emailMock.verification).toHaveLength(1),
      { timeout: 5_000 },
    );
    const token = verificationTokenFromUrl(
      emailMock.verification[0]!.verifyUrl,
    );

    // Unknown addresses get the same 202 and no email.
    const unknown = await resendVerificationRoute.POST(
      request('/api/v1/auth/resend-verification', {
        method: 'POST',
        body: { email: `missing-${randomUUID()}@example.com` },
      }),
    );
    expect(unknown.status).toBe(202);
    expect(await unknown.json()).toEqual({ ok: true });
    expect(emailMock.verification).toHaveLength(1);

    // A resend inside the 60s cooldown is accepted but does not send again.
    const throttled = await resendVerificationRoute.POST(
      request('/api/v1/auth/resend-verification', {
        method: 'POST',
        body: { email: pendingEmail },
      }),
    );
    expect(throttled.status).toBe(202);
    expect(await throttled.json()).toEqual({ ok: true });
    expect(emailMock.verification).toHaveLength(1);

    // The original link still works.
    const verified = await verifyEmailRoute.POST(
      request('/api/v1/auth/verify-email', {
        method: 'POST',
        body: { token, password },
      }),
    );
    expect(verified.status).toBe(200);
    const body = (await verified.json()) as { user: { id: string } };
    await db.delete(users).where(eq(users.id, body.user.id));
    emailMock.verification.length = 0;
  });


  it('logs in, rejects bad passwords, and rotates sessions', async () => {
    const badLogin = await loginRoute.POST(
      request('/api/v1/auth/login', {
        method: 'POST',
        body: { email, password: 'wrong password' },
      }),
    );
    expect(badLogin.status).toBe(401);

    const login = await loginRoute.POST(
      request('/api/v1/auth/login', {
        method: 'POST',
        body: { email, password },
      }),
    );
    expect(login.status).toBe(200);
    cookies = authCookies(login);
    const oldCookies = cookies;

    const missingCsrf = await refreshRoute.POST(
      request('/api/v1/auth/refresh', {
        method: 'POST',
        cookies: oldCookies,
        csrf: false,
      }),
    );
    expect(missingCsrf.status).toBe(403);

    const refreshed = await refreshRoute.POST(
      request('/api/v1/auth/refresh', {
        method: 'POST',
        cookies: oldCookies,
      }),
    );
    expect(refreshed.status).toBe(200);
    cookies = authCookies(refreshed);

    const stale = await meRoute.GET(
      request('/api/v1/me', { cookies: oldCookies }),
    );
    expect(stale.status).toBe(401);

    const current = await meRoute.GET(
      request('/api/v1/me', { cookies }),
    );
    expect(current.status).toBe(200);
  });

  it('throttles login attempts without revealing whether an account exists', async () => {
    resetRateLimitsForTests();
    const unknownEmail = `missing-${randomUUID()}@example.com`;

    const unknown = await loginRoute.POST(
      request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: unknownEmail, password: 'wrong password' },
      }),
    );
    const known = await loginRoute.POST(
      request('/api/v1/auth/login', {
        method: 'POST',
        body: { email, password: 'wrong password' },
      }),
    );

    expect(unknown.status).toBe(401);
    expect(known.status).toBe(401);
    const unknownBody = (await unknown.json()) as {
      error: { code: string; message: string; details?: unknown };
    };
    const knownBody = (await known.json()) as {
      error: { code: string; message: string; details?: unknown };
    };
    expect(unknownBody.error.code).toBe('UNAUTHORIZED');
    expect(unknownBody.error.message).toBe(knownBody.error.message);
    expect(unknownBody.error.details).toBe(knownBody.error.details);

    // 10 login attempts per IP per minute. Two were already consumed above.
    let last: Response | null = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      last = await loginRoute.POST(
        request('/api/v1/auth/login', {
          method: 'POST',
          body: {
            email: `throttle-${attempt}-${randomUUID()}@example.com`,
            password: 'wrong password',
          },
        }),
      );
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get('retry-after')).toBeTruthy();
  });

  it('throttles password reset requests per email and per IP', async () => {
    resetRateLimitsForTests();
    const target = `reset-throttle-${randomUUID()}@example.com`;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const accepted = await forgotPasswordRoute.POST(
        request('/api/v1/auth/forgot-password', {
          method: 'POST',
          body: { email: target },
        }),
      );
      expect(accepted.status).toBe(202);
    }

    const blocked = await forgotPasswordRoute.POST(
      request('/api/v1/auth/forgot-password', {
        method: 'POST',
        body: { email: target },
      }),
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
  });

  it('updates preferences and reports validation errors consistently', async () => {
    const missingCsrf = await preferencesRoute.PUT(
      request('/api/v1/user/preferences', {
        method: 'PUT',
        cookies,
        csrf: false,
        body: { topics: ['distributed systems'], excludedTopics: [] },
      }),
    );
    expect(missingCsrf.status).toBe(403);

    const invalid = await preferencesRoute.PUT(
      request('/api/v1/user/preferences', {
        method: 'PUT',
        cookies,
        body: { topics: [''], excludedTopics: [] },
      }),
    );
    expect(invalid.status).toBe(400);
    const invalidBody = (await invalid.json()) as {
      error: { code: string; requestId: string };
    };
    expect(invalidBody.error.code).toBe('BAD_REQUEST');
    expect(invalidBody.error.requestId).toMatch(/^req_/);

    const response = await preferencesRoute.PUT(
      request('/api/v1/user/preferences', {
        method: 'PUT',
        cookies,
        body: {
          topics: ['distributed systems', 'machine learning'],
          excludedTopics: ['crypto'],
          language: 'it',
        },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      preferences: { topics: string[]; language: string };
    };
    expect(body.preferences.language).toBe('it');
  });

  it('serves feed, card detail, interactions, reviews, saved cards, and export', async () => {
    const suffix = randomUUID();
    const [source] = await db
      .insert(sources)
      .values({
        ownerId: userId,
        title: 'API test source',
        url: `https://api.example.com/feed/${suffix}`,
        urlHash: `${suffix.replace(/-/g, '')}${'a'.repeat(32)}`,
        sourceType: 'RSS',
        isPublic: false,
      })
      .returning({ id: sources.id });
    sourceId = source!.id;

    const [article] = await db
      .insert(articles)
      .values({
        sourceId,
        title: 'API test article',
        originalUrl: `https://api.example.com/${suffix}`,
        canonicalUrl: `https://api.example.com/${suffix}`,
        urlHash: `${suffix.replace(/-/g, '')}${'b'.repeat(32)}`,
        status: 'ready',
        publishedAt: new Date(),
      })
      .returning({ id: articles.id });

    const [card] = await db
      .insert(cards)
      .values({
        articleId: article!.id,
        hook: 'A useful hook',
        coreConcept: 'A useful concept',
        keyTakeaways: ['First takeaway', 'Second takeaway'],
        estimatedReadTimeSec: 90,
        embedding: unitEmbedding(),
        embeddingDim: 1024,
        topicTags: ['machine learning'],
        language: 'it',
        status: 'published',
      })
      .returning({ id: cards.id });
    cardId = card!.id;

    const feed = await feedRoute.GET(
      request('/api/v1/feed?mode=learn&limit=10', { cookies }),
    );
    expect(feed.status).toBe(200);
    const feedBody = (await feed.json()) as {
      cards: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(feedBody.cards.some((entry) => entry.id === cardId)).toBe(true);

    const detail = await cardRoute.GET(
      request(`/api/v1/cards/${cardId}`, { cookies }),
      context(cardId),
    );
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as {
      card: { id: string; source: { title: string } };
    };
    expect(detailBody.card.source.title).toBe('API test source');

    const missingKey = await interactionRoute.POST(
      request(`/api/v1/cards/${cardId}/interaction`, {
        method: 'POST',
        cookies,
        body: { interaction_type: 'VIEW', dwell_time_ms: 999_999 },
      }),
      context(cardId),
    );
    expect(missingKey.status).toBe(400);

    const oversizedDwell = await interactionRoute.POST(
      request(`/api/v1/cards/${cardId}/interaction`, {
        method: 'POST',
        cookies,
        idempotency: 'interaction-oversized',
        body: { interaction_type: 'VIEW', dwell_time_ms: 999_999 },
      }),
      context(cardId),
    );
    expect(oversizedDwell.status).toBe(400);

    const interaction = await interactionRoute.POST(
      request(`/api/v1/cards/${cardId}/interaction`, {
        method: 'POST',
        cookies,
        idempotency: 'interaction-1',
        body: { interaction_type: 'VIEW', dwell_time_ms: 1_000 },
      }),
      context(cardId),
    );
    expect(interaction.status).toBe(201);
    const interactionBody = (await interaction.json()) as {
      duplicate: boolean;
      dwell_time_ms: number;
    };
    expect(interactionBody.duplicate).toBe(false);
    expect(interactionBody.dwell_time_ms).toBe(1_000);

    const duplicate = await interactionRoute.POST(
      request(`/api/v1/cards/${cardId}/interaction`, {
        method: 'POST',
        cookies,
        idempotency: 'interaction-1',
        body: { interaction_type: 'VIEW', dwell_time_ms: 10 },
      }),
      context(cardId),
    );
    expect(duplicate.status).toBe(200);
    expect(((await duplicate.json()) as { duplicate: boolean }).duplicate).toBe(true);

    const saved = await interactionRoute.POST(
      request(`/api/v1/cards/${cardId}/interaction`, {
        method: 'POST',
        cookies,
        idempotency: 'save-1',
        body: { interaction_type: 'SAVE' },
      }),
      context(cardId),
    );
    expect(saved.status).toBe(201);

    const review = await reviewRoute.POST(
      request(`/api/v1/cards/${cardId}/review`, {
        method: 'POST',
        cookies,
        idempotency: 'review-1',
        body: { interval_days: 7 },
      }),
      context(cardId),
    );
    expect(review.status).toBe(200);
    const reviewBody = (await review.json()) as {
      duplicate: boolean;
      next_review: string;
      state: number;
      interval_days: number;
    };
    expect(reviewBody.duplicate).toBe(false);
    expect(reviewBody.state).toBeGreaterThan(0);
    expect(reviewBody.interval_days).toBe(7);
    expect(Number.isNaN(Date.parse(reviewBody.next_review))).toBe(false);

    const duplicateReview = await reviewRoute.POST(
      request(`/api/v1/cards/${cardId}/review`, {
        method: 'POST',
        cookies,
        idempotency: 'review-1',
        body: { interval_days: 1 },
      }),
      context(cardId),
    );
    expect(duplicateReview.status).toBe(200);
    expect(((await duplicateReview.json()) as { duplicate: boolean }).duplicate).toBe(true);

    const savedList = await savedRoute.GET(
      request('/api/v1/me/saved', { cookies }),
    );
    expect(savedList.status).toBe(200);
    const savedBody = (await savedList.json()) as {
      cards: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(savedBody.cards.some((entry) => entry.id === cardId)).toBe(true);

    const detailAfterReview = await cardRoute.GET(
      request(`/api/v1/cards/${cardId}`, { cookies }),
      context(cardId),
    );
    const reviewed = (await detailAfterReview.json()) as {
      card: { saved: boolean; review: { state: number } | null };
    };
    expect(reviewed.card.saved).toBe(true);
    expect(reviewed.card.review?.state).toBeGreaterThan(0);

    const exported = await exportRoute.GET(
      request('/api/v1/me/export', { cookies }),
    );
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-disposition')).toContain(
      'attachment;',
    );
    const exportBody = (await exported.json()) as {
      profile: { id: string };
      interactions: unknown[];
      review_history: unknown[];
    };
    expect(exportBody.profile.id).toBe(userId);
    expect(exportBody.interactions.length).toBeGreaterThan(0);
    expect(exportBody.review_history.length).toBe(1);
  });

  it('lists sources, imports OPML, and exposes source status', async () => {
    const list = await sourcesRoute.GET(
      request('/api/v1/sources', { cookies }),
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      sources: Array<{ id: string; subscribed: boolean }>;
    };
    expect(listBody.sources.some((source) => source.id === sourceId)).toBe(true);

    const status = await sourceStatusRoute.GET(
      request(`/api/v1/sources/${sourceId}/status`, { cookies }),
      context(sourceId),
    );
    expect(status.status).toBe(200);

    const detail = await sourceRoute.GET(
      request(`/api/v1/sources/${sourceId}`, { cookies }),
      context(sourceId),
    );
    expect(detail.status).toBe(200);

    const opml = await opmlRoute.POST(
      request('/api/v1/sources/import/opml', {
        method: 'POST',
        cookies,
        body: undefined,
      }),
    );
    expect(opml.status).toBe(400);

    const opmlRequest = new Request(
      `${origin}/api/v1/sources/import/opml`,
      {
        method: 'POST',
        headers: {
          origin,
          cookie: cookies.cookie,
          [CSRF_HEADER]: cookies.csrf,
        },
        body: `<?xml version="1.0"?>
          <opml version="2.0">
            <body>
              <outline text="Tech">
                <outline text="Example" type="rss" xmlUrl="https://example.com/feed-${randomUUID()}.xml" />
              </outline>
            </body>
          </opml>`,
      },
    );
    const imported = await opmlRoute.POST(opmlRequest);
    expect(imported.status).toBe(202);
    const importedBody = (await imported.json()) as { imported: number };
    expect(importedBody.imported).toBe(1);
  });

  it('isolates cards from private sources from other users', async () => {
    const outsiderEmailValue = `outsider-${randomUUID()}@example.com`;
    outsiderEmail = outsiderEmailValue;
    const registered = await registerVerifiedAccount(
      outsiderEmailValue,
      password,
    );
    outsiderId = registered.userId;
    const outsiderCookies = registered.cookies;

    const feed = await feedRoute.GET(
      request('/api/v1/feed?mode=learn&limit=50', { cookies: outsiderCookies }),
    );
    expect(feed.status).toBe(200);
    const feedBody = (await feed.json()) as { cards: Array<{ id: string }> };
    expect(feedBody.cards.some((entry) => entry.id === cardId)).toBe(false);

    const detail = await cardRoute.GET(
      request(`/api/v1/cards/${cardId}`, { cookies: outsiderCookies }),
      context(cardId),
    );
    expect(detail.status).toBe(404);

    const interaction = await interactionRoute.POST(
      request(`/api/v1/cards/${cardId}/interaction`, {
        method: 'POST',
        cookies: outsiderCookies,
        idempotency: 'outsider-interaction',
        body: { interaction_type: 'SAVE' },
      }),
      context(cardId),
    );
    expect(interaction.status).toBe(404);

    const review = await reviewRoute.POST(
      request(`/api/v1/cards/${cardId}/review`, {
        method: 'POST',
        cookies: outsiderCookies,
        idempotency: 'outsider-review',
        body: { interval_days: 7 },
      }),
      context(cardId),
    );
    expect(review.status).toBe(404);

    const saved = await savedRoute.GET(
      request('/api/v1/me/saved', { cookies: outsiderCookies }),
    );
    expect(saved.status).toBe(200);
    const savedBody = (await saved.json()) as { cards: Array<{ id: string }> };
    expect(savedBody.cards).toEqual([]);

    // The source itself must also be unreachable and immutable for outsiders.
    const sourceDetail = await sourceRoute.GET(
      request(`/api/v1/sources/${sourceId}`, { cookies: outsiderCookies }),
      context(sourceId),
    );
    expect(sourceDetail.status).toBe(404);

    // A stale user_sources row from a previous ownership/subscription bug must
    // not grant access to someone else's private source.
    await db
      .insert(userSources)
      .values({ userId: outsiderId, sourceId })
      .onConflictDoNothing();

    const sourceStatus = await sourceStatusRoute.GET(
      request(`/api/v1/sources/${sourceId}/status`, {
        cookies: outsiderCookies,
      }),
      context(sourceId),
    );
    expect(sourceStatus.status).toBe(404);

    await db
      .delete(userSources)
      .where(
        and(
          eq(userSources.userId, outsiderId),
          eq(userSources.sourceId, sourceId),
        ),
      );

    const sourceSubscribe = await subscribeRoute.POST(
      request(`/api/v1/sources/${sourceId}/subscribe`, {
        method: 'POST',
        cookies: outsiderCookies,
      }),
      context(sourceId),
    );
    expect(sourceSubscribe.status).toBe(404);

    const sourceDelete = await sourceRoute.DELETE(
      request(`/api/v1/sources/${sourceId}`, {
        method: 'DELETE',
        cookies: outsiderCookies,
      }),
      context(sourceId),
    );
    expect(sourceDelete.status).toBe(404);

    // The owner still sees the source after the outsider's delete attempt.
    const stillThere = await sourceRoute.GET(
      request(`/api/v1/sources/${sourceId}`, { cookies }),
      context(sourceId),
    );
    expect(stillThere.status).toBe(200);
  });

  it('lets another user add the same private feed URL as an independent source', async () => {
    expect(outsiderId).toBeTruthy();
    expect(outsiderEmail).toBeTruthy();
    resetRateLimitsForTests();

    const sharedUrl = `https://private.example.com/shared-${randomUUID()}.xml`;
    const ownerSource = await upsertSource(db, {
      url: sharedUrl,
      title: 'Owner copy',
      sourceType: 'RSS',
      ownerId: userId,
      isPublic: false,
    });

    const login = await loginRoute.POST(
      request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: outsiderEmail, password },
      }),
    );
    expect(login.status).toBe(200);
    const outsiderCookies = authCookies(login);

    // Importing the same private URL must create the outsider's own row rather
    // than returning a conflict or sharing the original row.
    const opmlRequest = new Request(
      `${origin}/api/v1/sources/import/opml`,
      {
        method: 'POST',
        headers: {
          origin,
          cookie: outsiderCookies.cookie,
          [CSRF_HEADER]: outsiderCookies.csrf,
        },
        body: `<?xml version="1.0"?>
          <opml version="2.0">
            <body>
              <outline text="Private" type="rss" xmlUrl="${sharedUrl}" />
            </body>
          </opml>`,
      },
    );
    const imported = await opmlRoute.POST(opmlRequest);
    expect(imported.status).toBe(202);
    const importedBody = (await imported.json()) as {
      imported: number;
      sources: Array<{ id: string; owner_id: string }>;
    };
    expect(importedBody.imported).toBe(1);
    const outsiderSource = importedBody.sources[0]!;
    expect(outsiderSource.id).not.toBe(ownerSource.id);
    expect(outsiderSource.owner_id).toBe(outsiderId);

    // Re-adding the same URL for the same owner reuses their own row.
    const sameOwnerAgain = await upsertSource(db, {
      url: sharedUrl,
      title: 'Owner copy again',
      sourceType: 'RSS',
      ownerId: outsiderId!,
      isPublic: false,
    });
    expect(sameOwnerAgain.id).toBe(outsiderSource.id);

    const rows = await db
      .select({ id: sources.id, ownerId: sources.ownerId })
      .from(sources)
      .where(eq(sources.urlHash, hashUrl(sharedUrl)));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.ownerId))).toEqual(
      new Set([userId, outsiderId]),
    );
  });

  it('serves health, OpenAPI, and admin endpoints', async () => {
    // Admin endpoints now require both the shared token and an authenticated
    // session whose database role is "admin".
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, userId));

    const health = await healthRoute.GET(
      request('/api/v1/health'),
    );
    expect(health.status).toBe(200);

    const openapi = await openApiRoute.GET(
      request('/api/v1/openapi'),
    );
    expect(openapi.status).toBe(200);
    const document = (await openapi.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(document.openapi).toBe('3.1.0');
    expect(document.paths['/api/v1/feed']).toBeDefined();

    const unauthorized = await usageRoute.GET(
      request('/api/v1/admin/usage'),
    );
    expect(unauthorized.status).toBe(401);

    const usage = await usageRoute.GET(
      request('/api/v1/admin/usage', { token: adminToken, cookies }),
    );
    expect(usage.status).toBe(200);
    const usageBody = (await usage.json()) as {
      totals: { articles: number; llm_tokens: number; embedding_tokens: number };
    };
    expect(usageBody.totals.articles).toBeGreaterThanOrEqual(1);

    const queueUnauthorized = await adminQueueRoute.GET(
      request('/api/v1/admin/queue'),
    );
    expect(queueUnauthorized.status).toBe(401);
    const queue = await adminQueueRoute.GET(
      request('/api/v1/admin/queue', { token: adminToken, cookies }),
    );
    expect(queue.status).toBe(200);
    const queueBody = (await queue.json()) as { driver: string; queues: unknown[] };
    expect(queueBody.driver).toBe('pg-boss');
    expect(queueBody.queues.length).toBeGreaterThan(0);

    const activeSources = await adminSourcesRoute.GET(
      request('/api/v1/admin/sources?is_active=true&source_type=RSS', {
        token: adminToken,
        cookies,
      }),
    );
    expect(activeSources.status).toBe(200);
    const activeBody = (await activeSources.json()) as {
      items: Array<{ id: string }>;
    };
    expect(activeBody.items.some((source) => source.id === sourceId)).toBe(true);

    // "false" must filter instead of being coerced to boolean true.
    const inactiveSources = await adminSourcesRoute.GET(
      request('/api/v1/admin/sources?is_active=false', {
        token: adminToken,
        cookies,
      }),
    );
    expect(inactiveSources.status).toBe(200);
    const inactiveBody = (await inactiveSources.json()) as {
      items: Array<{ id: string }>;
    };
    expect(inactiveBody.items.some((source) => source.id === sourceId)).toBe(false);

    // Only the canonical source type values are accepted.
    const legacyType = await adminSourcesRoute.GET(
      request('/api/v1/admin/sources?source_type=JSON', {
        token: adminToken,
        cookies,
      }),
    );
    expect(legacyType.status).toBe(400);

    const ingest = await ingestRoute.POST(
      request('/api/v1/admin/ingest', {
        method: 'POST',
        token: adminToken,
        cookies,
        body: { source_id: sourceId },
      }),
    );
    expect(ingest.status).toBe(202);

    const reembed = await reembedRoute.POST(
      request('/api/v1/admin/reembed', {
        method: 'POST',
        token: adminToken,
        cookies,
        body: { user_id: userId },
      }),
    );
    expect(reembed.status).toBe(202);
  });

  it('removes reported content through the admin takedown flow', async () => {
    const unauthorized = await takedownRoute.POST(
      request('/api/v1/admin/takedown', {
        method: 'POST',
        body: { article_id: cardId },
      }),
    );
    expect(unauthorized.status).toBe(401);

    const invalid = await takedownRoute.POST(
      request('/api/v1/admin/takedown', {
        method: 'POST',
        token: adminToken,
        cookies,
        body: { article_id: cardId, card_id: cardId },
      }),
    );
    expect(invalid.status).toBe(400);

    const removed = await takedownRoute.POST(
      request('/api/v1/admin/takedown', {
        method: 'POST',
        token: adminToken,
        cookies,
        body: { card_id: cardId, reason: 'Rights-holder request' },
      }),
    );
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as { removed: boolean }).removed).toBe(true);

    const [hidden] = await db
      .select({ status: cards.status, articleId: cards.articleId })
      .from(cards)
      .where(eq(cards.id, cardId));
    expect(hidden?.status).toBe('hidden');
    const [scrubbed] = await db
      .select({ status: articles.status, raw: articles.rawContent })
      .from(articles)
      .where(eq(articles.id, hidden?.articleId ?? ''));
    expect(scrubbed?.status).toBe('skipped');
    expect(scrubbed?.raw).toBeNull();
  });

  it('requests and consumes a one-time password reset token', async () => {
    resetRateLimitsForTests();
    emailMock.reset.length = 0;

    const unknown = await forgotPasswordRoute.POST(
      request('/api/v1/auth/forgot-password', {
        method: 'POST',
        body: { email: `missing-${randomUUID()}@example.com` },
      }),
    );
    expect(unknown.status).toBe(202);
    expect(emailMock.reset).toHaveLength(0);

    const requested = await forgotPasswordRoute.POST(
      request('/api/v1/auth/forgot-password', {
        method: 'POST',
        body: { email },
      }),
    );
    expect(requested.status).toBe(202);
    // The email is sent after the response so timing does not reveal whether
    // the account exists; wait for the detached task to finish.
    await vi.waitFor(
      () => expect(emailMock.reset).toHaveLength(1),
      { timeout: 5_000 },
    );

    const sent = emailMock.reset[0];
    expect(sent?.to).toBe(email);
    expect(sent?.expiresInMinutes).toBe(30);
    const resetUrl = new URL(sent!.resetUrl);
    expect(resetUrl.pathname).toBe('/reset-password');
    const token = resetUrl.searchParams.get('token');
    expect(token).toBeTruthy();

    const [issued] = await db
      .select({ usedAt: passwordResetTokens.usedAt })
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, userId));
    expect(issued?.usedAt).toBeNull();

    const invalid = await resetPasswordRoute.POST(
      request('/api/v1/auth/reset-password', {
        method: 'POST',
        body: { token: 'invalid-token'.padEnd(43, 'x'), password: newPassword },
      }),
    );
    expect(invalid.status).toBe(400);

    const oldCookies = cookies;
    const reset = await resetPasswordRoute.POST(
      request('/api/v1/auth/reset-password', {
        method: 'POST',
        body: { token, password: newPassword },
      }),
    );
    expect(reset.status).toBe(200);
    cookies = authCookies(reset);

    const stale = await meRoute.GET(
      request('/api/v1/me', { cookies: oldCookies }),
    );
    expect(stale.status).toBe(401);
    const current = await meRoute.GET(
      request('/api/v1/me', { cookies }),
    );
    expect(current.status).toBe(200);

    const reuse = await resetPasswordRoute.POST(
      request('/api/v1/auth/reset-password', {
        method: 'POST',
        body: { token, password: newPassword },
      }),
    );
    expect(reuse.status).toBe(400);

    const [used] = await db
      .select({ usedAt: passwordResetTokens.usedAt })
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, userId));
    expect(used?.usedAt).not.toBeNull();

    const expired = await createPasswordResetToken(
      db,
      userId,
      new Date(Date.now() - PASSWORD_RESET_TTL_MS - 1_000),
    );
    const expiredReset = await resetPasswordRoute.POST(
      request('/api/v1/auth/reset-password', {
        method: 'POST',
        body: { token: expired.token, password: newPassword },
      }),
    );
    expect(expiredReset.status).toBe(400);

    const oldLogin = await loginRoute.POST(
      request('/api/v1/auth/login', {
        method: 'POST',
        body: { email, password },
      }),
    );
    expect(oldLogin.status).toBe(401);
    const newLogin = await loginRoute.POST(
      request('/api/v1/auth/login', {
        method: 'POST',
        body: { email, password: newPassword },
      }),
    );
    expect(newLogin.status).toBe(200);
    cookies = authCookies(newLogin);
  });

  it('logs out and deletes the account', async () => {
    const loggedOut = await logoutRoute.POST(
      request('/api/v1/auth/logout', { method: 'POST', cookies }),
    );
    expect(loggedOut.status).toBe(204);

    const afterLogout = await meRoute.GET(
      request('/api/v1/me', { cookies }),
    );
    expect(afterLogout.status).toBe(401);

    const login = await loginRoute.POST(
      request('/api/v1/auth/login', {
        method: 'POST',
        body: { email, password: newPassword },
      }),
    );
    expect(login.status).toBe(200);
    cookies = authCookies(login);

    const deleted = await meRoute.DELETE(
      request('/api/v1/me', { method: 'DELETE', cookies }),
    );
    expect(deleted.status).toBe(204);

    const [remaining] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId));
    expect(remaining).toBeUndefined();
    userId = '';
  });
});

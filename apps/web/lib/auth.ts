import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from '@openscroll/db';
import { passwordResetTokens, sessions, users } from '@openscroll/db';
import {
  appendCookie,
  assertCsrf,
  assertSameOrigin,
  CSRF_COOKIE,
  getClientIp,
  getCookie,
  HttpError,
  SESSION_COOKIE,
} from './http';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export interface AuthUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
}

export interface AuthSession {
  sessionId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  user: AuthUser;
}

export interface CreatedSession {
  token: string;
  csrfToken: string;
  session: AuthSession;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  hashed: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(hashed, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

let dummyPasswordHash: Promise<string> | null = null;

/**
 * Verify a password even when no account/hash exists, using an Argon2 hash
 * generated once at startup. Without this, a missing user returns in a few
 * milliseconds while a real user costs a full Argon2 verification, which leaks
 * account existence through response timing (user enumeration).
 */
export async function verifyPasswordConstantTime(
  hashed: string | null | undefined,
  password: string,
): Promise<boolean> {
  if (hashed) {
    return verifyPassword(hashed, password);
  }

  dummyPasswordHash ??= hashPassword(randomBytes(32).toString('base64url'));
  await verifyPassword(await dummyPasswordHash, password);
  return false;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createPasswordResetToken(
  db: Database,
  userId: string,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);

  await db.transaction(async (tx) => {
    await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
    await tx.insert(passwordResetTokens).values({
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
    });
  });

  return { token, expiresAt };
}

export async function resetPasswordWithToken(
  db: Database,
  token: string,
  password: string,
  now = new Date(),
): Promise<string> {
  const tokenHash = hashSessionToken(token);
  const [record] = await db
    .select({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
    })
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, now),
      ),
    )
    .limit(1);

  if (!record) {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid or expired reset link');
  }

  const passwordHash = await hashPassword(password);

  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(passwordResetTokens.id, record.id),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, now),
        ),
      )
      .returning({ userId: passwordResetTokens.userId });

    if (!claimed) {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid or expired reset link');
    }

    await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(passwordResetTokens.userId, claimed.userId),
          isNull(passwordResetTokens.usedAt),
        ),
      );
    await tx
      .update(users)
      .set({ hashedPassword: passwordHash, updatedAt: now })
      .where(eq(users.id, claimed.userId));
    await tx
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, claimed.userId), isNull(sessions.revokedAt)));
  });

  return record.userId;
}

export async function createSession(
  db: Database,
  userId: string,
  request: Request,
  now = new Date(),
): Promise<CreatedSession> {
  const token = randomToken();
  const csrfToken = randomToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash,
      userAgent: request.headers.get('user-agent')?.slice(0, 1_024) ?? null,
      ipAddress: getClientIp(request),
      expiresAt,
    })
    .returning({ id: sessions.id, createdAt: sessions.createdAt });

  if (!row) {
    throw new HttpError(500, 'INTERNAL_ERROR', 'Failed to create session');
  }

  const [user] = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    throw new HttpError(500, 'INTERNAL_ERROR', 'User not found after session creation');
  }

  return {
    token,
    csrfToken,
    session: {
      sessionId: row.id,
      tokenHash,
      createdAt: row.createdAt,
      expiresAt,
      user: { id: user.id, email: user.email, role: user.role as 'user' | 'admin' },
    },
  };
}

export async function getAuthSession(
  request: Request,
  db: Database,
  now = new Date(),
): Promise<AuthSession | null> {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) {
    return null;
  }

  const tokenHash = hashSessionToken(token);
  const [row] = await db
    .select({
      sessionId: sessions.id,
      tokenHash: sessions.tokenHash,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    sessionId: row.sessionId,
    tokenHash: row.tokenHash,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    user: {
      id: row.userId,
      email: row.email,
      role: row.role as 'user' | 'admin',
    },
  };
}

export async function requireAuth(
  request: Request,
  db: Database,
): Promise<AuthSession> {
  assertSameOrigin(request);
  assertCsrf(request);

  const session = await getAuthSession(request, db);
  if (!session) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
  }
  return session;
}

export async function rotateSession(
  db: Database,
  session: AuthSession,
  now = new Date(),
): Promise<CreatedSession> {
  const token = randomToken();
  const csrfToken = randomToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  await db
    .update(sessions)
    .set({ tokenHash, expiresAt })
    .where(and(eq(sessions.id, session.sessionId), isNull(sessions.revokedAt)));

  return {
    token,
    csrfToken,
    session: {
      ...session,
      tokenHash,
      expiresAt,
    },
  };
}

export async function revokeSession(
  db: Database,
  sessionId: string,
  now = new Date(),
): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

export function setAuthCookies(
  response: Response,
  values: { token: string; csrfToken: string },
): void {
  appendCookie(response, SESSION_COOKIE, values.token, {
    httpOnly: true,
    maxAge: SESSION_TTL_MS / 1000,
  });
  appendCookie(response, CSRF_COOKIE, values.csrfToken, {
    httpOnly: false,
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearAuthCookies(response: Response): void {
  appendCookie(response, SESSION_COOKIE, '', { httpOnly: true, maxAge: 0 });
  appendCookie(response, CSRF_COOKIE, '', { httpOnly: false, maxAge: 0 });
}

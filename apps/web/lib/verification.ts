import { randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  emailVerificationSends,
  emailVerificationTokens,
  sessions,
  userPreferences,
  users,
  type Database,
} from '@openscroll/db';
import {
  hashSessionToken,
  verifyPasswordConstantTime,
} from './auth';
import { HttpError } from './http';

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const EMAIL_VERIFICATION_COOLDOWN_MS = 60 * 1000;
export const EMAIL_VERIFICATION_PER_ADDRESS_DAILY_LIMIT = 3;
export const EMAIL_VERIFICATION_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type VerificationSkipReason =
  | 'already_verified'
  | 'unknown_account'
  | 'cooldown'
  | 'address_limit'
  | 'global_limit';

export type VerificationBudgetReason =
  | 'cooldown'
  | 'address_limit'
  | 'global_limit';

export interface PreparedVerification {
  send: boolean;
  userId: string | null;
  token: string | null;
  expiresAt: Date | null;
  reason?: VerificationSkipReason;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function newVerificationToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Pure budget check, kept separate so it can be unit tested. The database
 * queries supply the counts; this function decides whether an email may leave.
 */
export function evaluateVerificationBudget(input: {
  recentSends: number;
  addressSends24h: number;
  globalSends24h: number;
  globalLimit: number;
  perAddressLimit?: number;
}): { allowed: true } | { allowed: false; reason: VerificationBudgetReason } {
  if (input.recentSends > 0) {
    return { allowed: false, reason: 'cooldown' };
  }
  if (input.addressSends24h >= (input.perAddressLimit ?? EMAIL_VERIFICATION_PER_ADDRESS_DAILY_LIMIT)) {
    return { allowed: false, reason: 'address_limit' };
  }
  if (input.globalSends24h >= input.globalLimit) {
    return { allowed: false, reason: 'global_limit' };
  }
  return { allowed: true };
}

interface PrepareInput {
  email: string;
  /**
   * The password chosen in this registration attempt. Pass `null` for a resend:
   * it must not change the password of an unverified account.
   */
  passwordHash: string | null;
  ip: string | null;
  globalDailyLimit: number;
  now?: Date;
}

/**
 * Create or refresh an unverified account and prepare a verification email.
 *
 * The account (and the email) is only created when the budget allows it, so an
 * attacker who exhausts the global cap cannot leave behind a trail of unusable
 * accounts. Re-registering an existing unverified address replaces both the
 * password and the token under the same advisory lock, so an old link can never
 * verify a password that was changed afterwards.
 */
export async function prepareEmailVerification(
  db: Database,
  input: PrepareInput,
): Promise<PreparedVerification> {
  const email = normalizeEmail(input.email);
  const now = input.now ?? new Date();
  const cooldownStart = new Date(now.getTime() - EMAIL_VERIFICATION_COOLDOWN_MS);
  const windowStart = new Date(
    now.getTime() - EMAIL_VERIFICATION_DAILY_WINDOW_MS,
  );
  const token = newVerificationToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS);

  return db.transaction(async (tx) => {
    // Serialize all registrations for the same address. This prevents two
    // concurrent requests from issuing different tokens/passwords, and lets
    // verification use the same lock to avoid racing a password replacement.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`email-verification:${email}`}))`,
    );

    const [existing] = await tx
      .select({
        id: users.id,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);

    if (existing?.emailVerifiedAt) {
      return {
        send: false,
        userId: existing.id,
        token: null,
        expiresAt: null,
        reason: 'already_verified',
      };
    }
    if (!existing && input.passwordHash === null) {
      // Resend for an address that has no pending registration.
      return {
        send: false,
        userId: null,
        token: null,
        expiresAt: null,
        reason: 'unknown_account',
      };
    }

    // One global lock keeps the hard daily budget accurate across instances.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('email-verification:global'))`,
    );

    const [recent] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(emailVerificationSends)
      .where(
        and(
          eq(emailVerificationSends.email, email),
          gt(emailVerificationSends.createdAt, cooldownStart),
        ),
      );
    const [address] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(emailVerificationSends)
      .where(
        and(
          eq(emailVerificationSends.email, email),
          gt(emailVerificationSends.createdAt, windowStart),
        ),
      );
    const [global] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(emailVerificationSends)
      .where(gt(emailVerificationSends.createdAt, windowStart));

    const budget = evaluateVerificationBudget({
      recentSends: recent?.count ?? 0,
      addressSends24h: address?.count ?? 0,
      globalSends24h: global?.count ?? 0,
      globalLimit: input.globalDailyLimit,
    });
    if (!budget.allowed) {
      return {
        send: false,
        userId: existing?.id ?? null,
        token: null,
        expiresAt: null,
        reason: budget.reason,
      };
    }

    let userId = existing?.id ?? null;
    if (userId) {
      await tx
        .update(users)
        .set({
          ...(input.passwordHash === null
            ? {}
            : { hashedPassword: input.passwordHash }),
          updatedAt: now,
        })
        .where(eq(users.id, userId));

      if (input.passwordHash !== null) {
        // Re-claiming an unverified address replaces its password; any session
        // that predates the change must not survive it.
        await tx
          .update(sessions)
          .set({ revokedAt: now })
          .where(
            and(eq(sessions.userId, userId), isNull(sessions.revokedAt)),
          );
      }
    } else {
      const [created] = await tx
        .insert(users)
        .values({ email, hashedPassword: input.passwordHash })
        .returning({ id: users.id });
      if (!created) {
        throw new Error('User insert returned no row');
      }
      userId = created.id;
      await tx
        .insert(userPreferences)
        .values({ userId })
        .onConflictDoNothing();
    }

    // Exactly one outstanding link per account.
    await tx
      .delete(emailVerificationTokens)
      .where(eq(emailVerificationTokens.userId, userId));
    await tx.insert(emailVerificationTokens).values({
      userId,
      tokenHash,
      expiresAt,
    });
    await tx.insert(emailVerificationSends).values({
      email,
      ...(input.ip ? { ipAddress: input.ip } : {}),
    });

    return {
      send: true,
      userId,
      token,
      expiresAt,
    };
  });
}

/**
 * Consume a verification token and activate the account. The password chosen
 * at registration must be supplied as well: without it, a victim who clicks an
 * unsolicited link would activate an account whose password is known to the
 * attacker. Revokes any session created before verification (pre-hijacking
 * defence) and returns the user id.
 */
export async function verifyEmailWithToken(
  db: Database,
  token: string,
  password: string,
  now = new Date(),
): Promise<string> {
  const tokenHash = hashSessionToken(token);
  const [found] = await db
    .select({
      email: users.email,
      hashedPassword: users.hashedPassword,
    })
    .from(emailVerificationTokens)
    .innerJoin(
      users,
      eq(users.id, emailVerificationTokens.userId),
    )
    .where(
      and(
        eq(emailVerificationTokens.tokenHash, tokenHash),
        isNull(emailVerificationTokens.usedAt),
        gt(emailVerificationTokens.expiresAt, now),
      ),
    )
    .limit(1);

  // Pay for an Argon2 verification even when the token is unknown, and use the
  // same error for both cases, so the endpoint is not an oracle for token
  // validity or account state.
  const passwordValid = await verifyPasswordConstantTime(
    found?.hashedPassword,
    password,
  );
  if (!found || !passwordValid) {
    throw new HttpError(
      400,
      'BAD_REQUEST',
      'Invalid or expired verification link, or incorrect password',
    );
  }

  const email = normalizeEmail(found.email);
  let userId: string | null = null;

  await db.transaction(async (tx) => {
    // Same lock as prepareEmailVerification: a concurrent re-registration
    // either happens entirely before or entirely after this verification.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`email-verification:${email}`}))`,
    );

    const [record] = await tx
      .select({
        id: emailVerificationTokens.id,
        userId: emailVerificationTokens.userId,
      })
      .from(emailVerificationTokens)
      .where(
        and(
          eq(emailVerificationTokens.tokenHash, tokenHash),
          isNull(emailVerificationTokens.usedAt),
          gt(emailVerificationTokens.expiresAt, now),
        ),
      )
      .limit(1);

    if (!record) {
      throw new HttpError(
        400,
        'BAD_REQUEST',
        'Invalid or expired verification link',
      );
    }

    const [claimed] = await tx
      .update(emailVerificationTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(emailVerificationTokens.id, record.id),
          isNull(emailVerificationTokens.usedAt),
          gt(emailVerificationTokens.expiresAt, now),
        ),
      )
      .returning({ userId: emailVerificationTokens.userId });

    if (!claimed) {
      throw new HttpError(
        400,
        'BAD_REQUEST',
        'Invalid or expired verification link',
      );
    }

    await tx
      .update(users)
      .set({ emailVerifiedAt: now, updatedAt: now })
      .where(eq(users.id, claimed.userId));

    await tx
      .update(emailVerificationTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(emailVerificationTokens.userId, claimed.userId),
          isNull(emailVerificationTokens.usedAt),
        ),
      );

    await tx
      .update(sessions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(sessions.userId, claimed.userId),
          isNull(sessions.revokedAt),
        ),
      );

    userId = claimed.userId;
  });

  if (!userId) {
    throw new HttpError(500, 'INTERNAL_ERROR', 'Verification failed');
  }
  return userId;
}

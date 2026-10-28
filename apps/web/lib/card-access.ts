import { eq, isNull, or } from 'drizzle-orm';
import { sources } from '@openscroll/db';

/**
 * Cards are readable when they belong to a public source, to a private source
 * owned by the requesting user, or to no source at all (legacy/manual cards).
 *
 * Deliberately does NOT trust `user_sources`: a subscription row must never
 * widen access to another user's private source.
 */
export function accessibleSourceCondition(userId: string) {
  return or(
    isNull(sources.id),
    eq(sources.isPublic, true),
    eq(sources.ownerId, userId),
  );
}

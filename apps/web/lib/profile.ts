import { eq } from 'drizzle-orm';
import type { UserProfile } from '@openscroll/contracts';
import type { Database } from '@openscroll/db';
import { userPreferences, users } from '@openscroll/db';
import { HttpError } from './http';

export async function getProfile(
  db: Database,
  userId: string,
): Promise<UserProfile> {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      userVectorUpdatedAt: users.userVectorUpdatedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    throw new HttpError(404, 'NOT_FOUND', 'User not found');
  }

  const [preferences] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  return {
    id: user.id,
    email: user.email,
    role: user.role as 'user' | 'admin',
    created_at: user.createdAt.toISOString(),
    user_vector_updated_at: user.userVectorUpdatedAt?.toISOString() ?? null,
    preferences: preferences
      ? {
          topics: preferences.topics,
          excludedTopics: preferences.excludedTopics,
          ...(preferences.language ? { language: preferences.language } : {}),
          updated_at: preferences.updatedAt.toISOString(),
        }
      : null,
  };
}

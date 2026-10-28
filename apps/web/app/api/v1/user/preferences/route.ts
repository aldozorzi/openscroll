import { PreferencesSchema } from '@openscroll/contracts';
import { userPreferences } from '@openscroll/db';
import { userSingletonKey } from '@openscroll/queue';
import { requireAuth } from '../../../../../lib/auth';
import { getDb } from '../../../../../lib/db';
import { invalidateFeedCache } from '../../../../../lib/feed';
import { handleRoute, json, parseJson } from '../../../../../lib/http';
import { enqueueSafely } from '../../../../../lib/queue';
import { enforceRateLimit } from '../../../../../lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    const session = await requireAuth(request, db);
    enforceRateLimit(`preferences:${session.user.id}`, 30, 60_000);

    const input = await parseJson(request, PreferencesSchema);
    const now = new Date();
    const language = input.language ?? null;

    const [preferences] = await db
      .insert(userPreferences)
      .values({
        userId: session.user.id,
        topics: input.topics,
        excludedTopics: input.excludedTopics,
        language,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          topics: input.topics,
          excludedTopics: input.excludedTopics,
          language,
          updatedAt: now,
        },
      })
      .returning();

    await invalidateFeedCache(session.user.id);
    await enqueueSafely(
      'recompute-user-vector',
      { userId: session.user.id },
      { singletonKey: userSingletonKey(session.user.id) },
    );

    return json({
      preferences: preferences
        ? {
            topics: preferences.topics,
            excludedTopics: preferences.excludedTopics,
            ...(preferences.language ? { language: preferences.language } : {}),
            updated_at: preferences.updatedAt.toISOString(),
          }
        : null,
    });
  });
}

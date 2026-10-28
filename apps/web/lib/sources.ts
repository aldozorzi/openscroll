import { and, eq } from 'drizzle-orm';
import type { SourceType } from '@openscroll/contracts';
import type { Database } from '@openscroll/db';
import { sources, userSources } from '@openscroll/db';
import { hashUrl } from '@openscroll/ingest';
import { isUniqueViolation } from './db-errors';

export type SourceRow = typeof sources.$inferSelect;

/**
 * A private source is only visible to its owner. Public sources are shared.
 * Public subscription endpoints use this to avoid leaking another user's
 * private source through an id.
 */
export function canSubscribeToSource(
  source: Pick<SourceRow, 'isPublic' | 'ownerId'>,
  userId: string,
): boolean {
  return source.isPublic || source.ownerId === userId;
}

export function sourceTypeFromContentType(contentType: string): SourceType {
  const normalized = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (normalized === 'application/atom+xml') {
    return 'ATOM';
  }
  if (normalized === 'application/feed+json') {
    return 'JSON_FEED';
  }
  return 'RSS';
}

export async function findSourceByUrl(
  db: Database,
  url: string,
): Promise<SourceRow | null> {
  const [source] = await db
    .select()
    .from(sources)
    .where(
      and(
        eq(sources.urlHash, hashUrl(url)),
        eq(sources.isPublic, true),
      ),
    )
    .limit(1);
  return source ?? null;
}

export async function findPrivateSourceByOwner(
  db: Database,
  url: string,
  ownerId: string,
): Promise<SourceRow | null> {
  const [source] = await db
    .select()
    .from(sources)
    .where(
      and(
        eq(sources.urlHash, hashUrl(url)),
        eq(sources.ownerId, ownerId),
        eq(sources.isPublic, false),
      ),
    )
    .limit(1);
  return source ?? null;
}

async function findExistingSource(
  db: Database,
  input: {
    url: string;
    ownerId: string | null;
    isPublic: boolean;
  },
): Promise<SourceRow | null> {
  // Always prefer the canonical public source when one exists, so adding a
  // public URL subscribes to the shared row instead of duplicating its feed.
  const publicSource = await findSourceByUrl(db, input.url);
  if (publicSource) {
    return publicSource;
  }
  if (!input.isPublic && input.ownerId) {
    return findPrivateSourceByOwner(db, input.url, input.ownerId);
  }
  return null;
}

export async function upsertSource(
  db: Database,
  input: {
    url: string;
    title: string;
    sourceType: SourceType;
    ownerId: string | null;
    isPublic: boolean;
    category?: string | null;
  },
): Promise<SourceRow> {
  const existing = await findExistingSource(db, input);
  if (existing) {
    return existing;
  }

  try {
    const [created] = await db
      .insert(sources)
      .values({
        ownerId: input.ownerId,
        title: input.title,
        url: input.url,
        urlHash: hashUrl(input.url),
        sourceType: input.sourceType,
        category: input.category ?? null,
        isPublic: input.isPublic,
        isActive: true,
        nextFetchAt: new Date(),
      })
      .returning();
    if (!created) {
      throw new Error('Source insert returned no row');
    }
    return created;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await findExistingSource(db, input);
      if (raced) {
        return raced;
      }
    }
    throw error;
  }
}

export async function subscribeToSource(
  db: Database,
  userId: string,
  sourceId: string,
): Promise<void> {
  await db
    .insert(userSources)
    .values({ userId, sourceId })
    .onConflictDoUpdate({
      target: [userSources.userId, userSources.sourceId],
      set: { isActive: true },
    });
}

export async function unsubscribeFromSource(
  db: Database,
  userId: string,
  sourceId: string,
): Promise<void> {
  await db
    .delete(userSources)
    .where(
      and(eq(userSources.userId, userId), eq(userSources.sourceId, sourceId)),
    );
}

export function serializeSource(
  source: SourceRow,
  subscribed: boolean,
  articleCount?: number,
): Record<string, unknown> {
  return {
    id: source.id,
    owner_id: source.ownerId,
    title: source.title,
    url: source.url,
    source_type: source.sourceType,
    category: source.category,
    is_public: source.isPublic,
    is_active: source.isActive,
    subscribed,
    last_fetched_at: source.lastFetchedAt?.toISOString() ?? null,
    next_fetch_at: source.nextFetchAt?.toISOString() ?? null,
    article_count: articleCount,
    created_at: source.createdAt.toISOString(),
  };
}

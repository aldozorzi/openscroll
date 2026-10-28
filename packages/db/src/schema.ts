import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  date,
  doublePrecision,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { vector1024 } from './vector';

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  hashedPassword: text('hashed_password'),
  role: text('role').notNull().default('user'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  userVector: vector1024('user_vector'),
  userVectorUpdatedAt: timestamp('user_vector_updated_at', {
    withTimezone: true,
  }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  topics: jsonb('topics')
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  excludedTopics: jsonb('excluded_topics')
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  language: text('language'),
  updatedAt: updatedAt(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
  userAgent: text('user_agent'),
  ipAddress: inet('ip_address'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index('password_reset_tokens_user_id_idx').on(table.userId),
    index('password_reset_tokens_expires_at_idx').on(table.expiresAt),
  ],
);

export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index('email_verification_tokens_user_id_idx').on(table.userId),
    index('email_verification_tokens_expires_at_idx').on(table.expiresAt),
  ],
);

/**
 * Audit/budget log for verification emails. Keeping it in the database (rather
 * than the in-process rate limiter) means the per-address and global caps hold
 * across multiple app instances.
 */
export const emailVerificationSends = pgTable(
  'email_verification_sends',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    ipAddress: inet('ip_address'),
    createdAt: createdAt(),
  },
  (table) => [
    index('email_verification_sends_email_created_at_idx').on(
      table.email,
      table.createdAt,
    ),
    index('email_verification_sends_created_at_idx').on(table.createdAt),
  ],
);

export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    title: text('title').notNull(),
    url: text('url').notNull(),
    urlHash: char('url_hash', { length: 64 }).notNull(),
    sourceType: text('source_type').notNull(),
    category: text('category'),
    isPublic: boolean('is_public').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    etag: text('etag'),
    lastModified: text('last_modified'),
    fetchIntervalMinutes: integer('fetch_interval_minutes')
      .notNull()
      .default(60),
    nextFetchAt: timestamp('next_fetch_at', { withTimezone: true }),
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // There is exactly one canonical public source per URL.
    uniqueIndex('sources_public_url_key')
      .on(table.urlHash)
      .where(sql`${table.isPublic} = true`),
    // Private sources are scoped to their owner: two users may independently
    // add the same private feed URL without sharing a row or its data.
    uniqueIndex('sources_private_owner_url_key')
      .on(table.ownerId, table.urlHash)
      .where(sql`${table.isPublic} = false`),
  ],
);

export const userSources = pgTable(
  'user_sources',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.sourceId] })],
);

export const articles = pgTable('articles', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').references(() => sources.id, {
    onDelete: 'cascade',
  }),
  title: text('title').notNull(),
  originalUrl: text('original_url').notNull(),
  canonicalUrl: text('canonical_url').notNull(),
  urlHash: char('url_hash', { length: 64 }).notNull().unique(),
  contentHash: char('content_hash', { length: 64 }),
  rawContent: text('raw_content'),
  cleanedContent: text('cleaned_content'),
  author: text('author'),
  language: text('language'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  retentionExpiresAt: timestamp('retention_expires_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const cards = pgTable(
  'cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    hook: text('hook').notNull(),
    coreConcept: text('core_concept').notNull(),
    keyTakeaways: jsonb('key_takeaways').$type<string[]>().notNull(),
    estimatedReadTimeSec: integer('estimated_read_time_sec').notNull(),
    embedding: vector1024('embedding'),
    embeddingModel: text('embedding_model'),
    embeddingDim: smallint('embedding_dim'),
    topicTags: jsonb('topic_tags')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    language: text('language'),
    recallPrompt: text('recall_prompt'),
    answer: text('answer'),
    generationModel: text('generation_model'),
    promptVersion: text('prompt_version'),
    status: text('status').notNull().default('published'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('cards_article_language_prompt_key').on(
      table.articleId,
      table.language,
      table.promptVersion,
    ),
  ],
);

export const userInteractions = pgTable(
  'user_interactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    interactionType: text('interaction_type').notNull(),
    dwellTimeMs: integer('dwell_time_ms').notNull().default(0),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('user_interactions_user_idempotency_key').on(
      table.userId,
      table.idempotencyKey,
    ),
  ],
);

export const userCardReviews = pgTable(
  'user_card_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    stability: doublePrecision('stability').notNull().default(0),
    difficulty: doublePrecision('difficulty').notNull().default(0),
    elapsedDays: integer('elapsed_days').notNull().default(0),
    scheduledDays: integer('scheduled_days').notNull().default(1),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    state: smallint('state').notNull().default(0),
    step: integer('step').notNull().default(0),
    desiredRetention: doublePrecision('desired_retention')
      .notNull()
      .default(0.9),
    fsrsParams: jsonb('fsrs_params').$type<Record<string, unknown>>(),
    lastReview: timestamp('last_review', { withTimezone: true }),
    nextReview: timestamp('next_review', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('user_card_reviews_user_card_key').on(
      table.userId,
      table.cardId,
    ),
  ],
);

export const cardReviews = pgTable(
  'card_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    rating: smallint('rating').notNull(),
    stateBefore: smallint('state_before').notNull(),
    stateAfter: smallint('state_after').notNull(),
    stabilityBefore: doublePrecision('stability_before').notNull(),
    stabilityAfter: doublePrecision('stability_after').notNull(),
    difficultyBefore: doublePrecision('difficulty_before').notNull(),
    difficultyAfter: doublePrecision('difficulty_after').notNull(),
    elapsedDays: integer('elapsed_days').notNull(),
    scheduledDays: integer('scheduled_days').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('card_reviews_user_idempotency_key').on(
      table.userId,
      table.idempotencyKey,
    ),
  ],
);

export const providerUsage = pgTable(
  'provider_usage',
  {
    provider: text('provider').notNull(),
    metric: text('metric').notNull(),
    usageDate: date('usage_date', { mode: 'string' }).notNull(),
    value: bigint('value', { mode: 'number' }).notNull().default(0),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({
      columns: [table.provider, table.metric, table.usageDate],
    }),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (table) => [index('audit_log_created_idx').on(table.createdAt)],
);

export const schema = {
  users,
  userPreferences,
  sessions,
  sources,
  userSources,
  articles,
  cards,
  userInteractions,
  userCardReviews,
  cardReviews,
  providerUsage,
  auditLog,
};

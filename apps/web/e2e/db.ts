import { createHash, randomBytes } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

function loadTestEnvIfExists(): { DATABASE_URL: string; DIRECT_URL: string } | null {
  if (process.env.OPENSCROLL_USE_TEST_DB !== 'true') {
    return null;
  }
  try {
    const envFile = join(tmpdir(), 'openscroll-test-env.json');
    const content = readFileSync(envFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

const testEnv = loadTestEnvIfExists();
const envSource = testEnv ?? process.env;

if (!testEnv) {
  loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
}

let pool: Pool | null = null;

export function getPool(): Pool {
  pool ??= new Pool({
    connectionString: (envSource as NodeJS.ProcessEnv).DIRECT_URL ?? (envSource as NodeJS.ProcessEnv).DATABASE_URL,
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export const E2E_SOURCES = [
  {
    title: 'E2E Systems Review',
    url: 'https://e2e.openscroll.local/systems.xml',
    category: 'engineering',
  },
  {
    title: 'E2E Learning Notes',
    url: 'https://e2e.openscroll.local/learning.xml',
    category: 'science',
  },
];

export const E2E_CARDS = [
  {
    slug: 'cache-invalidation',
    sourceIndex: 0,
    hook: 'Why is cache invalidation still called hard?',
    topicTags: ['distributed systems', 'software engineering', 'machine learning'],
  },
  {
    slug: 'spaced-repetition',
    sourceIndex: 1,
    hook: 'What makes spaced repetition different from rereading?',
    topicTags: ['psychology', 'learning'],
  },
  {
    slug: 'small-batches',
    sourceIndex: 0,
    hook: 'Why do smaller batches reveal problems sooner?',
    topicTags: ['software engineering', 'product design'],
  },
] as const;

const coreConcept = [
  'A useful idea becomes durable when it is retrieved rather than merely recognized.',
  'Recognition feels fluent, but fluency is not the same as memory.',
  'Retrieval practice asks the learner to reconstruct an answer from partial cues,',
  'which strengthens the route back to the idea and exposes gaps while they are cheap to fix.',
  'Spacing adds a second pressure: each successful recall happens after a little forgetting,',
  'so the memory must work a bit harder and the schedule can adapt to the learner.',
  'The practical lesson is to design for active recall, short feedback loops, and honest ratings,',
  'not for the comfortable feeling of having seen something before.',
].join(' ');

const directUrlHash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const embedding = `[${Array.from({ length: 1024 }, (_, index) =>
  ((index % 17) + 1) / 100,
).join(',')}]`;

export async function createPasswordResetTokenForEmail(
  email: string,
): Promise<string> {
  const db = getPool();
  const { rows } = await db.query<{ id: string }>(
    'select id from users where lower(email) = lower($1)',
    [email],
  );
  const userId = rows[0]?.id;
  if (!userId) {
    throw new Error(`E2E user ${email} was not created`);
  }

  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await db.query('delete from password_reset_tokens where user_id = $1', [userId]);
  await db.query(
    `insert into password_reset_tokens (user_id, token_hash, expires_at)
     values ($1, $2, now() + interval '30 minutes')`,
    [userId, tokenHash],
  );
  return token;
}

/**
 * Mint a verification token for an account created through the UI. The real
 * token is only delivered by email, which E2E cannot read, so the test helper
 * replaces it with a known value and lets the browser consume it.
 */
export async function createEmailVerificationTokenForEmail(
  email: string,
): Promise<string> {
  const db = getPool();
  const { rows } = await db.query<{ id: string }>(
    'select id from users where lower(email) = lower($1)',
    [email],
  );
  const userId = rows[0]?.id;
  if (!userId) {
    throw new Error(`E2E user ${email} was not created`);
  }

  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await db.query('delete from email_verification_tokens where user_id = $1', [
    userId,
  ]);
  await db.query(
    `insert into email_verification_tokens (user_id, token_hash, expires_at)
     values ($1, $2, now() + interval '24 hours')`,
    [userId, tokenHash],
  );
  return token;
}

export async function seedContent(): Promise<void> {
  const db = getPool();

  console.log('Seeding E2E sources and cards...');
  for (const [index, source] of E2E_SOURCES.entries()) {
    await db.query(
      `insert into sources (title, url, url_hash, source_type, category, is_public, is_active)
       values ($1, $2, $3, 'RSS', $4, true, true)
       on conflict (url_hash) where is_public = true do update
         set title = excluded.title, is_active = true`,
      [source.title, source.url, directUrlHash(source.url), source.category],
    );

    const { rows } = await db.query<{ id: string }>(
      'select id from sources where url_hash = $1',
      [directUrlHash(source.url)],
    );
    const sourceId = rows[0]?.id;
    if (!sourceId) {
      throw new Error(`E2E source ${index} was not created`);
    }
    console.log(`Created source ${index}: ${source.title} (${sourceId})`);

    for (const card of E2E_CARDS.filter(
      (candidate) => candidate.sourceIndex === index,
    )) {
      const originalUrl = `https://e2e.openscroll.local/articles/${card.slug}`;
      const urlHash = directUrlHash(originalUrl);
      await db.query(
        `insert into articles
           (source_id, title, original_url, canonical_url, url_hash, status, language, published_at)
         values ($1, $2, $3, $3, $4, 'ready', 'en', now())
         on conflict (url_hash) do update set
           source_id = excluded.source_id,
           title = excluded.title,
           status = 'ready',
           published_at = excluded.published_at`,
        [sourceId, card.hook, originalUrl, urlHash],
      );

      const article = await db.query<{ id: string }>(
        'select id from articles where url_hash = $1',
        [urlHash],
      );
      const articleId = article.rows[0]?.id;
      if (!articleId) {
        throw new Error(`E2E article ${card.slug} was not created`);
      }

      await db.query(
        `insert into cards
           (article_id, hook, core_concept, key_takeaways, estimated_read_time_sec,
            embedding, embedding_model, embedding_dim, topic_tags, language, status, prompt_version)
         values ($1, $2, $3, $4::jsonb, 75, $5::vector, 'e2e', 1024, $6::jsonb, 'en', 'published', 'e2e')
         on conflict (article_id, language, prompt_version) do update set
           hook = excluded.hook,
           core_concept = excluded.core_concept,
           key_takeaways = excluded.key_takeaways,
           embedding = excluded.embedding,
           topic_tags = excluded.topic_tags,
           status = 'published'`,
        [
          articleId,
          card.hook,
          coreConcept,
          JSON.stringify([
            'Retrieval beats recognition when the goal is durable memory.',
            'Spacing makes each successful recall do useful work.',
            'Short feedback loops expose gaps before they compound.',
          ]),
          embedding,
          JSON.stringify(card.topicTags),
        ],
      );
      console.log(`Created card: ${card.slug} (${articleId})`);
    }
  }
  console.log('E2E seeding complete');
}

async function userIdForEmail(email: string): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    'select id from users where lower(email) = lower($1)',
    [email],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error(`E2E user ${email} was not found`);
  }
  return id;
}

export async function makeAllCardsDue(email: string): Promise<void> {
  const userId = await userIdForEmail(email);
  const db = getPool();

  for (const card of E2E_CARDS) {
    const url = `https://e2e.openscroll.local/articles/${card.slug}`;
    const { rows } = await db.query<{ id: string }>(
      `select cards.id
       from cards
       join articles on articles.id = cards.article_id
       where articles.url_hash = $1`,
      [directUrlHash(url)],
    );
    const cardId = rows[0]?.id;
    if (!cardId) {
      throw new Error(`E2E card ${card.slug} was not found`);
    }

    await db.query(
      `insert into user_card_reviews
         (user_id, card_id, stability, difficulty, elapsed_days, scheduled_days,
          reps, lapses, state, step, desired_retention, last_review, next_review)
       values ($1, $2, 4.2, 4.8, 2, 2, 1, 0, 2, 0, 0.9, now() - interval '2 days', now() - interval '1 day')
       on conflict (user_id, card_id) do update set
         next_review = now() - interval '1 day',
         last_review = now() - interval '2 days',
         state = 2,
         reps = greatest(user_card_reviews.reps, 1)`,
      [userId, cardId],
    );
  }
}

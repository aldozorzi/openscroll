import 'dotenv/config';
import { createHash } from 'node:crypto';
import { createDb } from './client';
import { sources } from './schema';

const seedSources = [
  {
    title: 'Hacker News',
    url: 'https://hnrss.org/frontpage',
    sourceType: 'RSS',
    category: 'technology',
  },
  {
    title: 'Ars Technica',
    url: 'https://feeds.arstechnica.com/arstechnica/index',
    sourceType: 'RSS',
    category: 'technology',
  },
];

async function main(): Promise<void> {
  const { db, pool } = createDb();

  try {
    for (const source of seedSources) {
      const urlHash = createHash('sha256').update(source.url).digest('hex');
      await db
        .insert(sources)
        .values({
          title: source.title,
          url: source.url,
          urlHash,
          sourceType: source.sourceType,
          category: source.category,
          isPublic: true,
        })
        .onConflictDoNothing();
      console.log(`seeded ${source.title}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

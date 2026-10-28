import 'dotenv/config';
import { eq, inArray, sql } from 'drizzle-orm';
import { createDb } from './client';
import { articles, cards, sources } from './schema';
import {
  TECH_SOURCE_CATEGORIES,
  isTechSourceCategory,
} from './tech-categories';

interface Options {
  dryRun: boolean;
  purgeContent: boolean;
  activate: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    dryRun: false,
    purgeContent: false,
    activate: false,
  };
  for (const argument of argv) {
    if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--purge-content') {
      options.purgeContent = true;
    } else if (argument === '--activate') {
      options.activate = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { db, pool } = createDb();

  try {
    const allSources = await db
      .select({
        id: sources.id,
        title: sources.title,
        category: sources.category,
        isActive: sources.isActive,
      })
      .from(sources);

    const active = allSources.filter((source) => source.isActive);
    const inactive = allSources.filter((source) => !source.isActive);
    const activeOffTopic = active.filter(
      (source) => !isTechSourceCategory(source.category),
    );
    const inactiveTech = inactive.filter((source) =>
      isTechSourceCategory(source.category),
    );

    console.log('=== TECH SOURCE CURATION ===');
    console.log(`allowed categories: ${TECH_SOURCE_CATEGORIES.join(', ')}`);
    console.log(`sources total:      ${allSources.length}`);
    console.log(`sources active:     ${active.length}`);
    console.log(`active off-topic:   ${activeOffTopic.length}`);
    console.log(`inactive tech:      ${inactiveTech.length}`);

    if (activeOffTopic.length > 0) {
      console.log('\nActive sources that would be deactivated:');
      for (const source of activeOffTopic) {
        console.log(`  - [${source.category ?? 'no category'}] ${source.title}`);
      }
    }

    if (options.dryRun) {
      console.log('\nDry run: no changes applied.');
      return;
    }

    if (activeOffTopic.length > 0) {
      await db
        .update(sources)
        .set({
          isActive: false,
          nextFetchAt: null,
          updatedAt: new Date(),
        })
        .where(
          inArray(
            sources.id,
            activeOffTopic.map((source) => source.id),
          ),
        );
      console.log(`\nDeactivated ${activeOffTopic.length} off-topic sources.`);
    }

    if (options.activate && inactiveTech.length > 0) {
      await db
        .update(sources)
        .set({
          isActive: true,
          nextFetchAt: new Date(),
          consecutiveFailures: 0,
          lastFailureAt: null,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(
          inArray(
            sources.id,
            inactiveTech.map((source) => source.id),
          ),
        );
      console.log(`Activated ${inactiveTech.length} tech sources.`);
    }

    if (options.purgeContent) {
      const [cardCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(cards);
      const [articleCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(articles);

      await db.delete(cards);
      await db.delete(articles);

      const currentActive = await db
        .select({ id: sources.id, category: sources.category })
        .from(sources)
        .where(eq(sources.isActive, true));
      const activeTechSources = currentActive.filter((source) =>
        isTechSourceCategory(source.category),
      );
      if (activeTechSources.length > 0) {
        await db
          .update(sources)
          .set({ nextFetchAt: new Date(), updatedAt: new Date() })
          .where(
            inArray(
              sources.id,
              activeTechSources.map((source) => source.id),
            ),
          );
      }

      console.log(
        `Purged ${cardCount?.count ?? 0} cards and ${
          articleCount?.count ?? 0
        } articles; reset ${activeTechSources.length} tech sources for ingestion.`,
      );
    }

    const finalActive = await db
      .select({ category: sources.category })
      .from(sources)
      .where(eq(sources.isActive, true));
    const activeTechCount = finalActive.filter((source) =>
      isTechSourceCategory(source.category),
    ).length;
    const activeOffTopicCount = finalActive.length - activeTechCount;

    console.log(
      `\nActive sources after curation: ${activeTechCount} tech, ${activeOffTopicCount} off-topic.`,
    );
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((error: unknown) => {
  console.error('Curation failed:', error);
  process.exitCode = 1;
});

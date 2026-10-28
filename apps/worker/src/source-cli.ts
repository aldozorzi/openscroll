import './load-env';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { getDirectDatabaseUrl, getServerEnv } from '@openscroll/config';
import { createDb, sources } from '@openscroll/db';
import {
  canonicalizeAndHash,
  discoverFeed,
  hashUrl,
  parseOpml,
  type OpmlFeed,
} from '@openscroll/ingest';
import {
  parseAddSourceArgs,
  sourceTypeFromContentType,
} from './source-command';
import { parseImportArgs } from './source-import';

const INSERT_BATCH = 100;
const MAX_OPML_DOWNLOAD_BYTES = 5 * 1024 * 1024;

async function readResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`OPML download exceeds the ${maxBytes} byte limit`);
  }
  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(`OPML download exceeds the ${maxBytes} byte limit`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

function usage(): void {
  console.log(
    [
      'Usage: openscroll-source <command>',
      '',
      'Commands:',
      '  add <url> [options]   Add or reactivate a central public feed source',
      '  import <path|url>     Import an OPML file, a directory of OPML files, or a URL',
      '  list [--active] [--failed] [--limit N]',
      '',
      'Add options:',
      '  --title <text>        Display title (defaults to the feed hostname)',
      '  --category <text>     Optional category',
      '  --interval <minutes>  Fetch interval (default: 60)',
      '  --type <rss|atom|json> Override feed type detection',
      '',
      'Import options:',
      '  --activate-category <name>  Activate imported sources in this category (repeatable)',
      '  --interval <minutes>        Fetch interval for imported sources (default: 360)',
      '  --limit <n>                 Import at most n unique feeds',
      '  --dry-run                   Parse and report without writing to the database',
      '',
      'Examples:',
      '  pnpm source:add https://hnrss.org/frontpage --title "Hacker News"',
      '  pnpm source:import /tmp/awesome-rss-feeds --dry-run',
      '  pnpm source:import /tmp/awesome-rss-feeds \\',
      '    --activate-category Tech --activate-category Programming \\',
      '    --activate-category Science --activate-category Italy',
      '  pnpm source:list --active',
      '  pnpm source:list --failed',
    ].join('\n'),
  );
}

async function addSource(argument: string[]): Promise<void> {
  const options = parseAddSourceArgs(argument);
  const discovered = await discoverFeed(options.url);
  if (!discovered) {
    throw new Error(
      'No RSS, Atom, or JSON feed was found. Pass the direct feed URL, or use --type if discovery returned the wrong format.',
    );
  }

  const canonical = canonicalizeAndHash(discovered.url);
  const sourceType =
    options.sourceType ?? sourceTypeFromContentType(discovered.contentType);
  const title = options.title ?? new URL(canonical.url).hostname;
  const now = new Date();
  const { db, pool } = createDb(getDirectDatabaseUrl(getServerEnv()));

  try {
    const [existing] = await db
      .select()
      .from(sources)
      .where(
        and(
          eq(sources.urlHash, canonical.hash),
          eq(sources.isPublic, true),
        ),
      )
      .limit(1);

    if (existing) {
      if (!existing.isPublic) {
        throw new Error(
          `A private source with this URL already exists (${existing.id}); refusing to promote it automatically.`,
        );
      }

      const [updated] = await db
        .update(sources)
        .set({
          title: options.title ?? existing.title,
          category: options.category ?? existing.category,
          sourceType,
          isPublic: true,
          isActive: true,
          fetchIntervalMinutes: options.intervalMinutes,
          nextFetchAt: now,
          consecutiveFailures: 0,
          lastFailureAt: null,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(sources.id, existing.id))
        .returning();

      console.log(`updated source ${updated?.id ?? existing.id}`);
      console.log(`  title: ${options.title ?? existing.title}`);
      console.log(`  url:   ${existing.url}`);
      console.log(`  type:  ${sourceType}`);
      console.log('Run `pnpm worker:run` to ingest it.');
      return;
    }

    const [created] = await db
      .insert(sources)
      .values({
        ownerId: null,
        title,
        url: canonical.url,
        urlHash: canonical.hash,
        sourceType,
        category: options.category ?? null,
        isPublic: true,
        isActive: true,
        fetchIntervalMinutes: options.intervalMinutes,
        nextFetchAt: now,
      })
      .returning();

    console.log(`added source ${created?.id ?? '(unknown)'}`);
    console.log(`  title: ${title}`);
    console.log(`  url:   ${canonical.url}`);
    console.log(`  type:  ${sourceType}`);
    console.log('Run `pnpm worker:run` to ingest it.');
  } finally {
    await pool.end();
  }
}

async function walkOpmlFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkOpmlFiles(path)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.opml')) {
      files.push(path);
    }
  }

  return files;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function opmlFilesForTarget(target: string): Promise<string[]> {
  const preferred = [
    join(target, 'recommended', 'with_category'),
    join(target, 'countries', 'with_category'),
  ];
  const directories: string[] = [];
  for (const directory of preferred) {
    if (await isDirectory(directory)) {
      directories.push(directory);
    }
  }

  const files =
    directories.length > 0
      ? (await Promise.all(directories.map(walkOpmlFiles))).flat()
      : await walkOpmlFiles(target);

  return files.sort();
}

async function readTarget(
  target: string,
): Promise<Array<{ name: string; content: string }>> {
  if (/^https?:\/\//i.test(target)) {
    const response = await fetch(target, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`Failed to download OPML: HTTP ${response.status}`);
    }
    return [
      {
        name: target,
        content: await readResponseText(response, MAX_OPML_DOWNLOAD_BYTES),
      },
    ];
  }

  const info = await stat(target);
  if (info.isDirectory()) {
    const files = await opmlFilesForTarget(target);
    if (files.length === 0) {
      throw new Error('No .opml files found in the target directory');
    }
    return Promise.all(
      files.map(async (file) => ({
        name: file,
        content: await readFile(file, 'utf8'),
      })),
    );
  }

  return [{ name: target, content: await readFile(target, 'utf8') }];
}

function categoryCounts(feeds: OpmlFeed[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const feed of feeds) {
    const category = feed.category ?? '(none)';
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

async function importSources(argument: string[]): Promise<void> {
  const options = parseImportArgs(argument);
  const files = await readTarget(options.target);
  const unique = new Map<string, OpmlFeed>();
  let parsed = 0;

  for (const file of files) {
    for (const feed of parseOpml(file.content)) {
      parsed += 1;
      const key = hashUrl(feed.url);
      if (!unique.has(key)) {
        unique.set(key, feed);
      }
    }
  }

  const selected = [...unique.values()].slice(0, options.limit ?? undefined);
  const counts = categoryCounts(selected);

  console.log(`files:        ${files.length}`);
  console.log(`opml entries: ${parsed}`);
  console.log(`unique feeds: ${unique.size}`);
  console.log(`selected:     ${selected.length}`);

  if (options.dryRun) {
    console.log('dry run: no database changes');
    console.log('categories:');
    for (const [category, count] of counts) {
      console.log(`  ${category}: ${count}`);
    }
    return;
  }

  const { db, pool } = createDb(getDirectDatabaseUrl(getServerEnv()));
  const now = new Date();
  let inserted = 0;

  try {
    for (let index = 0; index < selected.length; index += INSERT_BATCH) {
      const batch = selected.slice(index, index + INSERT_BATCH);
      const rows = await db
        .insert(sources)
        .values(
          batch.map((feed) => ({
            ownerId: null,
            title: feed.title,
            url: feed.url,
            urlHash: hashUrl(feed.url),
            sourceType: feed.sourceType,
            category: feed.category,
            isPublic: true,
            isActive: false,
            fetchIntervalMinutes: options.intervalMinutes,
            nextFetchAt: null,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: sources.id });
      inserted += rows.length;
    }

    let activated = 0;
    if (options.activateCategories.length > 0) {
      const categories = new Set(
        options.activateCategories.map((category) => category.toLowerCase()),
      );
      const hashes = selected
        .filter(
          (feed) =>
            feed.category && categories.has(feed.category.toLowerCase()),
        )
        .map((feed) => hashUrl(feed.url));

      if (hashes.length > 0) {
        const rows = await db
          .select({ id: sources.id, category: sources.category })
          .from(sources)
          .where(
            and(
              inArray(sources.urlHash, hashes),
              eq(sources.isPublic, true),
            ),
          );
        const ids = rows
          .filter(
            (row) =>
              row.category && categories.has(row.category.toLowerCase()),
          )
          .map((row) => row.id);

        if (ids.length > 0) {
          await db
            .update(sources)
            .set({
              isActive: true,
              nextFetchAt: now,
              consecutiveFailures: 0,
              lastFailureAt: null,
              lastError: null,
              updatedAt: now,
            })
            .where(inArray(sources.id, ids));
          activated = ids.length;
        }
      }
    }

    console.log(`inserted:     ${inserted}`);
    console.log(`existing:     ${selected.length - inserted}`);
    console.log(`activated:    ${activated}`);
    if (activated > 0) {
      console.log('Run `pnpm worker:run` to ingest the active sources.');
    }
  } finally {
    await pool.end();
  }
}

async function listSources(argument: string[]): Promise<void> {
  let activeOnly = false;
  let failedOnly = false;
  let limit: number | null = null;

  for (let index = 0; index < argument.length; index += 1) {
    const value = argument[index];
    if (value === '--active') {
      activeOnly = true;
    } else if (value === '--failed') {
      failedOnly = true;
    } else if (value === '--limit') {
      const parsed = Number(argument[index + 1]);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error('--limit must be a positive integer');
      }
      limit = parsed;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${value}`);
    }
  }

  const { db, pool } = createDb(getDirectDatabaseUrl(getServerEnv()));

  try {
    const conditions = [
      ...(activeOnly ? [eq(sources.isActive, true)] : []),
      ...(failedOnly ? [gt(sources.consecutiveFailures, 0)] : []),
    ];
    const base = db.select().from(sources);
    const filtered =
      conditions.length > 0 ? base.where(and(...conditions)) : base;
    const query = filtered.orderBy(desc(sources.createdAt));
    const rows = limit ? await query.limit(limit) : await query;

    if (rows.length === 0) {
      console.log('No sources configured.');
      return;
    }

    for (const source of rows) {
      const visibility = source.isPublic ? 'public' : 'private';
      const status = source.isActive ? 'active' : 'inactive';
      const failures =
        source.consecutiveFailures > 0
          ? `fails=${source.consecutiveFailures}`
          : '';
      console.log(
        [
          source.id,
          source.sourceType.padEnd(9),
          visibility.padEnd(7),
          status.padEnd(8),
          failures.padEnd(7),
          (source.category ?? '-').padEnd(18),
          source.title,
          source.url,
        ].join('  '),
      );
    }
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const [command, ...argument] = process.argv.slice(2);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    usage();
    return;
  }

  if (command === 'add') {
    await addSource(argument);
    return;
  }

  if (command === 'import') {
    await importSources(argument);
    return;
  }

  if (command === 'list') {
    await listSources(argument);
    return;
  }

  usage();
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

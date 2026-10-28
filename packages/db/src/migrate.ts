import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPool } from './client';

const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));

export const DEFAULT_DATABASE_URL =
  'postgresql://openscroll:openscroll@localhost:5432/openscroll';

export function resolveDatabaseUrl(): string {
  return (
    process.env.DIRECT_URL ??
    process.env.DATABASE_URL ??
    DEFAULT_DATABASE_URL
  );
}

/**
 * Applies every pending SQL migration in `packages/db/migrations` to the given
 * database. Safe to call on an already-migrated database: applied files are
 * recorded in `schema_migrations` and skipped.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const pool = createPool(connectionString, 1);
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const applied = await client.query<{ name: string }>(
        'SELECT name FROM schema_migrations WHERE name = $1',
        [file],
      );
      if (applied.rowCount) {
        console.log(`skip  ${file}`);
        continue;
      }

      const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
      console.log(`apply ${file}`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    console.log('migrations complete');
  } finally {
    client.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  await runMigrations(resolveDatabaseUrl());
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

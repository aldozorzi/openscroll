import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPool } from './client';

const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));

async function main(): Promise<void> {
  const connectionString =
    process.env.DIRECT_URL ??
    process.env.DATABASE_URL ??
    'postgresql://openscroll:openscroll@localhost:5432/openscroll';

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

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

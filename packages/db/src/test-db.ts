import 'dotenv/config';
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEST_DB_PREFIX = 'openscroll_test_';
const BASE_DIRECT_URL = process.env.DIRECT_URL ?? 'postgresql://openscroll:openscroll@localhost:5432/openscroll';

function parseUrl(url: string): { host: string; port: number; user: string; password: string; database: string } {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: parseInt(u.port || '5432'),
    user: u.username,
    password: u.password,
    database: u.pathname.slice(1),
  };
}

const baseConfig = parseUrl(process.env.DIRECT_URL ?? 'postgresql://openscroll:openscroll@localhost:5432/openscroll');

/**
 * The test database is cloned from the development database, which may contain
 * thousands of pending/failed pg-boss jobs. If those are left in place, the
 * test worker picks them up, retries them forever and `waitForDrain` never
 * observes an empty queue. Start every run with a clean job table.
 */
async function purgeQueueState(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = 'pgboss'`,
  );
  const jobTables = rows
    .map((row) => row.table_name)
    .filter((name) => name === 'job' || name === 'job_common')
    .map((name) => `pgboss."${name}"`);
  if (jobTables.length > 0) {
    await pool.query(`TRUNCATE TABLE ${jobTables.join(', ')} CASCADE`);
  }
}

async function createTestDatabase(testName: string): Promise<string> {
  const adminConfig = { ...parseUrl(process.env.DIRECT_URL ?? 'postgresql://openscroll:openscroll@localhost:5432/openscroll'), database: 'postgres' };
  const adminPool = new pg.Pool(adminConfig);

  const testDbName = `openscroll_test_${testName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const templateDb = process.env.TEST_TEMPLATE_DB || (await getTemplateDb());
    await adminPool.query(`CREATE DATABASE ${testDbName} TEMPLATE ${templateDb}`);
    console.log(`Created test database: ${testDbName}`);
    return testDbName;
  } finally {
    await adminPool.end();
  }
}

async function getTemplateDb(): Promise<string> {
  const templateName = 'openscroll_test_template';
  const adminConfig = { ...parseUrl(process.env.DIRECT_URL ?? 'postgresql://openscroll:openscroll@localhost:5432/openscroll'), database: 'postgres' };
  const adminPool = new pg.Pool({ ...parseUrl(process.env.DIRECT_URL ?? 'postgresql://openscroll:openscroll@localhost:5432/openscroll'), database: 'postgres' });

  try {
    const exists = await adminPool.query(`SELECT 1 FROM pg_database WHERE datname = 'openscroll_test_template'`);
    if (exists.rows.length === 0) {
      console.log('Creating test template database...');
      await adminPool.query(`CREATE DATABASE openscroll_test_template TEMPLATE openscroll`);
      console.log('Test template database created from openscroll (migrations already applied)');
    }
    return 'openscroll_test_template';
  } finally {
    await adminPool.end();
  }
}

interface TestDatabaseHandle {
  dbName: string;
  url: string;
  directUrl: string;
  pool: pg.Pool;
  db: any;
}

let sharedTestDb: TestDatabaseHandle | null = null;

export async function getSharedTestDb(): Promise<TestDatabaseHandle> {
  if (sharedTestDb) return sharedTestDb;

  const existingUrl =
    process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? null;
  if (
    process.env.OPENSCROLL_USE_TEST_DB === 'true' &&
    existingUrl &&
    new URL(existingUrl).pathname.slice(1).startsWith(TEST_DB_PREFIX)
  ) {
    const dbName = new URL(existingUrl).pathname.slice(1);
    const pool = new pg.Pool({
      connectionString: existingUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const db = drizzle(pool, { schema: await import('../src/schema') });
    sharedTestDb = {
      dbName,
      url: existingUrl,
      directUrl: existingUrl,
      pool,
      db,
    };
    console.log(`Reusing test database: ${dbName}`);
    return sharedTestDb;
  }

  const adminConfig = { ...parseUrl(process.env.DIRECT_URL ?? 'postgresql://openscroll:openscroll@localhost:5432/openscroll'), database: 'postgres' };
  const adminPool = new pg.Pool({ ...parseUrl(process.env.DIRECT_URL ?? 'postgresql://openscroll:openscroll@localhost:5432/openscroll'), database: 'postgres' });

  const testDbName = `openscroll_test_shared_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const templateDb = await getTemplateDb();
    await adminPool.query(`CREATE DATABASE ${testDbName} TEMPLATE ${templateDb}`);
    console.log(`Created shared test database: ${testDbName}`);
  } finally {
    await adminPool.end();
  }

  const url = `postgresql://openscroll:openscroll@localhost:5432/${testDbName}`;
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  await purgeQueueState(pool);

  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { schema } = await import('../src/schema');
  const db = drizzle(pool, { schema: await import('../src/schema') });

  sharedTestDb = { dbName: testDbName, url, directUrl: url, pool, db };
  return sharedTestDb;
}

export async function destroySharedTestDb(): Promise<void> {
  if (sharedTestDb) {
    await sharedTestDb.pool.end();
    const adminConfig = { ...parseUrl(process.env.DIRECT_URL ?? 'postgresql://openscroll:openscroll@localhost:5432/openscroll'), database: 'postgres' };
    const adminPool = new pg.Pool({ ...parseUrl(process.env.DIRECT_URL ?? 'postgresql://openscroll:openscroll@localhost:5432/openscroll'), database: 'postgres' });
    try {
      await adminPool.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${sharedTestDb.dbName}'`);
      await adminPool.query(`DROP DATABASE IF EXISTS ${sharedTestDb.dbName}`);
      console.log(`Dropped shared test database: ${sharedTestDb.dbName}`);
    } finally {
      await adminPool.end();
    }
    sharedTestDb = null;
  }
}

export async function truncateAllTables(db: any): Promise<void> {
  await db.execute(`
    TRUNCATE TABLE
      card_reviews,
      user_card_reviews,
      user_interactions,
      cards,
      articles,
      user_sources,
      sources,
      email_verification_sends,
      email_verification_tokens,
      password_reset_tokens,
      user_preferences,
      users,
      provider_usage,
      audit_log
    RESTART IDENTITY CASCADE;
  `);
}
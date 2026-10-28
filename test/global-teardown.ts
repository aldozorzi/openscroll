import { destroySharedTestDb } from '../packages/db/src/test-db';
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export default async function globalTeardown() {
  await destroySharedTestDb();
  const envFile = join(tmpdir(), 'openscroll-test-env.json');
  try {
    unlinkSync(envFile);
  } catch {}
}
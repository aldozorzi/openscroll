import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

let cachedEnv: { DATABASE_URL: string; DIRECT_URL: string } | null = null;

export function loadTestEnv(): { DATABASE_URL: string; DIRECT_URL: string } {
  if (cachedEnv) return cachedEnv;
  const envFile = join(tmpdir(), 'openscroll-test-env.json');
  const content = readFileSync(envFile, 'utf-8');
  cachedEnv = JSON.parse(content);
  process.env.DATABASE_URL = cachedEnv.DATABASE_URL;
  process.env.DIRECT_URL = cachedEnv.DIRECT_URL;
  return cachedEnv;
}

export function loadTestEnvSync(): { DATABASE_URL: string; DIRECT_URL: string } {
  if (cachedEnv) return cachedEnv;
  const envFile = join(tmpdir(), 'openscroll-test-env.json');
  const content = readFileSync(envFile, 'utf-8');
  cachedEnv = JSON.parse(content);
  return cachedEnv;
}
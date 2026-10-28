import { closePool } from './db';

export default async function globalTeardown(): Promise<void> {
  await closePool();
}

import { getServerEnv } from '@openscroll/config';
import {
  DEAD_LETTER_QUEUE,
  QUEUE_DEFINITIONS,
  type JobName,
} from '@openscroll/queue';
import { requireAdmin } from '../../../../../lib/admin';
import { getDb } from '../../../../../lib/db';
import { handleRoute, json } from '../../../../../lib/http';
import { getQueuePendingCount, getQueueStats } from '../../../../../lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JOB_NAMES = Object.keys(QUEUE_DEFINITIONS).filter(
  (name): name is JobName => name !== DEAD_LETTER_QUEUE,
);
const QUEUE_NAMES = [...JOB_NAMES, DEAD_LETTER_QUEUE];

export async function GET(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    await requireAdmin(request, db);
    const env = getServerEnv();
    const [queues, pending] = await Promise.all([
      getQueueStats(QUEUE_NAMES),
      getQueuePendingCount(JOB_NAMES),
    ]);

    return json({
      driver: env.QUEUE_DRIVER,
      pending,
      queues: queues.map((queue) => ({
        name: queue.name,
        queued: queue.queued,
        active: queue.active,
        completed: queue.completed,
        failed: queue.failed,
      })),
    });
  });
}

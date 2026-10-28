import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { sources } from '@openscroll/db';
import { sourceSingletonKey } from '@openscroll/queue';
import { requireAdmin } from '../../../../../lib/admin';
import { recordAuditEvent } from '../../../../../lib/audit';
import { getDb } from '../../../../../lib/db';
import {
  handleRoute,
  HttpError,
  json,
  parseOptionalJson,
} from '../../../../../lib/http';
import { enqueueJob } from '../../../../../lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AdminIngestSchema = z.object({
  source_id: z.uuid().optional(),
});

export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    const admin = await requireAdmin(request, db);
    const input = await parseOptionalJson(request, AdminIngestSchema);

    const targets = await db
      .select({ id: sources.id })
      .from(sources)
      .where(
        input.source_id
          ? eq(sources.id, input.source_id)
          : eq(sources.isActive, true),
      )
      .limit(100);

    if (input.source_id && targets.length === 0) {
      throw new HttpError(404, 'NOT_FOUND', 'Source not found');
    }

    const jobs: string[] = [];
    for (const source of targets) {
      const jobId = await enqueueJob(
        'ingest-source',
        { sourceId: source.id },
        { singletonKey: sourceSingletonKey(source.id) },
      );
      if (jobId) {
        jobs.push(jobId);
      }
    }

    await recordAuditEvent(db, {
      actorUserId: admin.user.id,
      action: 'admin.ingest',
      entityType: input.source_id ? 'source' : null,
      entityId: input.source_id ?? null,
      metadata: { targets: targets.length, queued: jobs.length },
    });

    return json({ queued: targets.length, jobs }, 202);
  });
}

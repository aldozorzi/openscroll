import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { users } from '@openscroll/db';
import { userSingletonKey } from '@openscroll/queue';
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

const ReembedSchema = z.object({
  user_id: z.uuid().optional(),
});

export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    const admin = await requireAdmin(request, db);
    const input = await parseOptionalJson(request, ReembedSchema);

    const targets = await db
      .select({ id: users.id })
      .from(users)
      .where(input.user_id ? eq(users.id, input.user_id) : undefined)
      .limit(500);

    if (input.user_id && targets.length === 0) {
      throw new HttpError(404, 'NOT_FOUND', 'User not found');
    }

    let queued = 0;
    for (const user of targets) {
      const jobId = await enqueueJob(
        'recompute-user-vector',
        { userId: user.id },
        { singletonKey: userSingletonKey(user.id) },
      );
      if (jobId) {
        queued += 1;
      }
    }

    await recordAuditEvent(db, {
      actorUserId: admin.user.id,
      action: 'admin.reembed',
      entityType: input.user_id ? 'user' : null,
      entityId: input.user_id ?? null,
      metadata: { targets: targets.length, queued },
    });

    return json({ users: targets.length, queued }, 202);
  });
}

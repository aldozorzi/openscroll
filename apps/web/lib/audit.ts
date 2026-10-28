import type { Database } from '@openscroll/db';
import { auditLog } from '@openscroll/db';
import { logSecurityEvent } from './security-log';

export interface AuditEvent {
  actorUserId: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Persist an administrative or security-relevant action. Audit failures are
 * logged but never rolled back the action itself: losing an audit row must not
 * turn a completed remediation into a failed request.
 */
export async function recordAuditEvent(
  db: Database,
  event: AuditEvent,
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actorUserId: event.actorUserId,
      action: event.action,
      entityType: event.entityType ?? null,
      entityId: event.entityId ?? null,
      metadata: event.metadata ?? {},
    });
  } catch (error) {
    logSecurityEvent(
      'audit_log_write_failed',
      {
        action: event.action,
        entityType: event.entityType ?? null,
        entityId: event.entityId ?? null,
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      'error',
    );
  }
}

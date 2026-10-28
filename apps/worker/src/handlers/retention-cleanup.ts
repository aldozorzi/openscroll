import type { WorkerContext } from '../context';
import { retentionCutoffs } from '../transform';

export interface RetentionCleanupResult {
  rawContentCleared: number;
  cleanedContentCleared: number;
  sessionsDeleted: number;
  resetTokensDeleted: number;
  verificationTokensDeleted: number;
  verificationSendsDeleted: number;
}

export async function retentionCleanup(
  ctx: WorkerContext,
): Promise<RetentionCleanupResult> {
  const now = ctx.now();
  const cutoffs = retentionCutoffs(
    now,
    ctx.env.RAW_CONTENT_RETENTION_DAYS,
    ctx.env.CLEANED_CONTENT_RETENTION_DAYS,
  );

  const raw = await ctx.pool.query(
    `UPDATE articles
        SET raw_content = NULL,
            updated_at = now()
      WHERE raw_content IS NOT NULL
        AND created_at < $1`,
    [cutoffs.rawContentBefore],
  );

  const cleaned = await ctx.pool.query(
    `UPDATE articles
        SET cleaned_content = NULL,
            updated_at = now()
      WHERE cleaned_content IS NOT NULL
        AND (
          retention_expires_at < $1
          OR (
            retention_expires_at IS NULL
            AND created_at < $2
          )
        )`,
    [now, cutoffs.cleanedContentBefore],
  );

  const sessions = await ctx.pool.query(
    `DELETE FROM sessions
      WHERE expires_at < now()
         OR (revoked_at IS NOT NULL AND revoked_at < now())`,
  );

  const resetTokens = await ctx.pool.query(
    `DELETE FROM password_reset_tokens
      WHERE expires_at < now()
         OR used_at IS NOT NULL`,
  );

  const verificationTokens = await ctx.pool.query(
    `DELETE FROM email_verification_tokens
      WHERE expires_at < now()
         OR used_at IS NOT NULL`,
  );

  // Sends only need to survive the 24h budget window. Keep 48h for auditing
  // while bounding table growth on busy instances.
  const verificationSends = await ctx.pool.query(
    `DELETE FROM email_verification_sends
      WHERE created_at < now() - interval '48 hours'`,
  );

  const result: RetentionCleanupResult = {
    rawContentCleared: raw.rowCount ?? 0,
    cleanedContentCleared: cleaned.rowCount ?? 0,
    sessionsDeleted: sessions.rowCount ?? 0,
    resetTokensDeleted: resetTokens.rowCount ?? 0,
    verificationTokensDeleted: verificationTokens.rowCount ?? 0,
    verificationSendsDeleted: verificationSends.rowCount ?? 0,
  };

  ctx.logger.info('retention_cleanup_completed', { ...result });
  return result;
}

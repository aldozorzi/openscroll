import { and, eq, gte } from 'drizzle-orm';
import { getServerEnv } from '@openscroll/config';
import { articles, providerUsage } from '@openscroll/db';
import { requireAdmin } from '../../../../../lib/admin';
import { getDb } from '../../../../../lib/db';
import { handleRoute, json } from '../../../../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    await requireAdmin(request, db);
    const env = getServerEnv();
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const startOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    const [rows, articleRows] = await Promise.all([
      db.select().from(providerUsage).where(eq(providerUsage.usageDate, today)),
      db
        .select({ id: articles.id })
        .from(articles)
        .where(and(gte(articles.createdAt, startOfDay))),
    ]);

    const llmTokens = rows
      .filter((row) => row.metric === 'llm_tokens')
      .reduce((sum, row) => sum + row.value, 0);
    const embeddingTokens = rows
      .filter((row) => row.metric === 'embedding_tokens')
      .reduce((sum, row) => sum + row.value, 0);

    return json({
      date: today,
      limits: {
        max_llm_tokens_per_day: env.MAX_LLM_TOKENS_PER_DAY,
        max_embedding_tokens_per_day: env.MAX_EMBEDDING_TOKENS_PER_DAY,
        llm_daily_budget_usd: env.LLM_DAILY_BUDGET_USD,
      },
      totals: {
        llm_tokens: llmTokens,
        embedding_tokens: embeddingTokens,
        articles: articleRows.length,
      },
      usage: rows.map((row) => ({
        provider: row.provider,
        metric: row.metric,
        value: row.value,
        updated_at: row.updatedAt.toISOString(),
      })),
    });
  });
}

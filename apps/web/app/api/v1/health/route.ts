import { getPool } from '../../../../lib/db';
import { handleRoute, json } from '../../../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    const startedAt = Date.now();
    try {
      await getPool().query('select 1');
      return json({
        status: 'ok',
        database: 'ok',
        latency_ms: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      });
    } catch {
      return json(
        {
          status: 'degraded',
          database: 'unavailable',
          latency_ms: Date.now() - startedAt,
          timestamp: new Date().toISOString(),
        },
        503,
      );
    }
  });
}

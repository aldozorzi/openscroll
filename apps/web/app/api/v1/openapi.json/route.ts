import { handleRoute, json } from '../../../../lib/http';
import { createOpenApiDocument } from '../../../../lib/openapi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return handleRoute(request, async () => json(createOpenApiDocument()));
}

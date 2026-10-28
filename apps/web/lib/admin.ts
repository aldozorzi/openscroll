import { timingSafeEqual } from 'node:crypto';
import { getServerEnv } from '@openscroll/config';
import type { Database } from '@openscroll/db';
import { getAuthSession, type AuthSession } from './auth';
import { assertSameOrigin, getClientIp, HttpError } from './http';
import { enforceRateLimit } from './rate-limit';
import { logSecurityEvent, requestPath } from './security-log';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function tokenFromRequest(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim();
  }
  return request.headers.get('x-admin-token');
}

export async function requireAdmin(
  request: Request,
  db: Database,
): Promise<AuthSession> {
  const path = requestPath(request);
  const ip = getClientIp(request) ?? 'unknown';

  // Defense in depth against CSRF: the admin token is normally carried in a
  // custom header, but reject cross-origin mutations outright as well.
  if (!SAFE_METHODS.has(request.method.toUpperCase())) {
    assertSameOrigin(request);
  }

  // 1. Verify the shared admin token.
  const supplied = tokenFromRequest(request);
  const expected = getServerEnv().ADMIN_TOKEN;

  if (!supplied) {
    logSecurityEvent('admin_auth_denied', {
      reason: 'missing_token',
      path,
      ip,
      method: request.method,
    });
    throw new HttpError(401, 'UNAUTHORIZED', 'Admin token required');
  }

  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    logSecurityEvent('admin_auth_denied', {
      reason: 'invalid_token',
      path,
      ip,
      method: request.method,
    });
    throw new HttpError(401, 'UNAUTHORIZED', 'Invalid admin token');
  }

  // 2. Verify the authenticated user also has the admin role. The role is
  // always read from the database, never from a client-controlled token.
  const session = await getAuthSession(request, db);
  if (!session) {
    logSecurityEvent('admin_auth_denied', {
      reason: 'missing_session',
      path,
      ip,
      method: request.method,
    });
    throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
  }
  if (session.user.role !== 'admin') {
    logSecurityEvent('admin_auth_denied', {
      reason: 'not_admin',
      path,
      ip,
      method: request.method,
      userId: session.user.id,
    });
    throw new HttpError(403, 'FORBIDDEN', 'Admin role required');
  }

  // 3. Rate limit per user and per IP so one compromised account cannot
  // exhaust the shared buckets for everybody else.
  enforceRateLimit(`admin:user:${session.user.id}`, 60, 60_000);
  enforceRateLimit(`admin:ip:${ip}`, 60, 60_000);

  return session;
}

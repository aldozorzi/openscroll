export type SecurityLogLevel = 'info' | 'warn' | 'error';

/**
 * Structured security event logging. Keep this separate from request logs so
 * authentication and authorization failures can be shipped to a SIEM or
 * alerting pipeline without scraping normal traffic.
 */
export function logSecurityEvent(
  event: string,
  data: Record<string, unknown> = {},
  level: SecurityLogLevel = 'warn',
): void {
  const line = JSON.stringify({
    level,
    event,
    time: new Date().toISOString(),
    ...data,
  });
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function requestPath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return 'unknown';
  }
}

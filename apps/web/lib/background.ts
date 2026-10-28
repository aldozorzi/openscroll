import { after } from 'next/server';
import { logSecurityEvent } from './security-log';

/**
 * Run work after the HTTP response has been sent.
 *
 * In a Next.js request scope we use `after()` so the runtime keeps the
 * invocation alive until the task completes. Route handlers are also invoked
 * directly from unit/integration tests, where `after()` throws because there
 * is no request scope; in that case we fall back to a detached promise.
 */
export function runAfterResponse(
  event: string,
  task: () => Promise<void>,
): void {
  const safeTask = () =>
    task().catch((error: unknown) => {
      logSecurityEvent(
        `${event}_failed`,
        {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        'error',
      );
    });

  try {
    after(safeTask);
  } catch {
    void safeTask();
  }
}

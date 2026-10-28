export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(event: string, data?: Record<string, unknown>): void;
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function write(
  level: LogLevel,
  event: string,
  data?: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    event,
    ...data,
  });
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export function createLogger(
  minimumLevel: LogLevel = process.env.NODE_ENV === 'test' ? 'error' : 'info',
): Logger {
  const minimum = LEVEL_PRIORITY[minimumLevel];

  return {
    debug(event, data) {
      if (LEVEL_PRIORITY.debug >= minimum) write('debug', event, data);
    },
    info(event, data) {
      if (LEVEL_PRIORITY.info >= minimum) write('info', event, data);
    },
    warn(event, data) {
      if (LEVEL_PRIORITY.warn >= minimum) write('warn', event, data);
    },
    error(event, data) {
      if (LEVEL_PRIORITY.error >= minimum) write('error', event, data);
    },
  };
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

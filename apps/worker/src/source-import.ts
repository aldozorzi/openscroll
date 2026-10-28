export interface ImportSourcesOptions {
  target: string;
  activateCategories: string[];
  intervalMinutes: number;
  limit: number | null;
  dryRun: boolean;
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseImportArgs(argv: string[]): ImportSourcesOptions {
  let target: string | undefined;
  const activateCategories: string[] = [];
  let intervalMinutes = 360;
  let limit: number | null = null;
  let dryRun = false;

  const MAX_CATEGORY_CHARS = 80;
  const MAX_INTERVAL_MINUTES = 10_080;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) {
      continue;
    }

    if (argument === '--activate-category') {
      const category = readValue(argv, index, '--activate-category')
        .trim()
        .slice(0, MAX_CATEGORY_CHARS);
      if (!category) {
        throw new Error('--activate-category requires a name');
      }
      activateCategories.push(category);
      index += 1;
      continue;
    }
    if (argument === '--interval') {
      const value = Number(readValue(argv, index, '--interval'));
      if (!Number.isInteger(value) || value < 1) {
        throw new Error('--interval must be a positive integer (minutes)');
      }
      if (value > MAX_INTERVAL_MINUTES) {
        throw new Error(
          `--interval must not exceed ${MAX_INTERVAL_MINUTES} minutes (one week)`,
        );
      }
      intervalMinutes = value;
      index += 1;
      continue;
    }
    if (argument === '--limit') {
      const value = Number(readValue(argv, index, '--limit'));
      if (!Number.isInteger(value) || value < 1) {
        throw new Error('--limit must be a positive integer');
      }
      limit = value;
      index += 1;
      continue;
    }
    if (argument === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (argument.startsWith('--')) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (target) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    target = argument;
  }

  if (!target) {
    throw new Error('An OPML file, directory, or URL is required');
  }

  return {
    target,
    activateCategories,
    intervalMinutes,
    limit,
    dryRun,
  };
}

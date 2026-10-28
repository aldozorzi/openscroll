export function cn(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(' ');
}

export function sourceDomain(url: string | null | undefined): string {
  if (!url) {
    return '';
  }
  try {
    return new URL(url).hostname.replace(/^www\./u, '');
  } catch {
    return url;
  }
}

export function formatReadTime(
  seconds: number,
  minutesLabel: (count: number) => string,
): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutesLabel(minutes);
}

export function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
  }).format(date);
}

export function relativeTime(
  value: string,
  locale: string,
  labels: {
    today: string;
    yesterday: string;
    daysAgo: (count: number) => string;
  },
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((start.getTime() - target.getTime()) / 86_400_000);
  if (days <= 0) {
    return labels.today;
  }
  if (days === 1) {
    return labels.yesterday;
  }
  if (days < 30) {
    return labels.daysAgo(days);
  }
  return formatDate(value, locale);
}

export function newIdempotencyKey(prefix = 'ui'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/gu, '');
}

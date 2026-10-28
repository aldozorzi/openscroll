import Link from 'next/link';
import { cn } from '../lib/utils';

export function Brand({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <Link
      href="/feed"
      className={cn(
        'focus-ring group inline-flex items-center gap-3 rounded-2xl',
        className,
      )}
      aria-label="OpenScroll"
    >
      <span className="relative flex h-10 w-10 items-center justify-center">
        <span className="absolute inset-x-1.5 top-2 h-2 rounded-full bg-accent" />
        <span className="absolute inset-x-1.5 top-[1.1rem] h-2 rounded-full bg-muted" />
        <span className="absolute bottom-2 end-1.5 h-1.5 w-1.5 rounded-full bg-success" />
      </span>
      {!compact && (
        <span className="flex flex-col">
          <span className="font-display text-lg font-semibold leading-none tracking-tight text-ink">
            OpenScroll
          </span>
          <span className="mt-1 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-muted">
            Learn more, scroll less
          </span>
        </span>
      )}
    </Link>
  );
}

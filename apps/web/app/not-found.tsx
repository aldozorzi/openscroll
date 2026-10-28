import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="surface-panel max-w-md rounded-3xl p-8 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-accent">404</p>
        <h1 className="mt-3 font-display text-3xl font-semibold">This page is not in the scroll.</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          The link may be old, or the card may have been hidden or removed.
        </p>
        <Link href="/feed" className="btn btn-primary mt-6">
          Back to the feed
        </Link>
      </div>
    </main>
  );
}

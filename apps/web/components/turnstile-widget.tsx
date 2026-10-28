'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

const TURNSTILE_SCRIPT =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileOptions {
  sitekey: string;
  action?: string;
  theme?: 'auto' | 'light' | 'dark';
  callback?: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: () => void;
  'timeout-callback'?: () => void;
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileOptions) => string;
  remove: (widgetId: string) => void;
}

type TurnstileWindow = Window & { turnstile?: TurnstileApi };

function getTurnstile(): TurnstileApi | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return (window as TurnstileWindow).turnstile;
}

/**
 * Renders the Turnstile widget and reports its token to the parent. `resetKey`
 * forces a new challenge after a rejected submission, because Turnstile tokens
 * are single-use.
 */
export function TurnstileWidget({
  siteKey,
  onToken,
  resetKey = 0,
  label,
  unavailableLabel,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  resetKey?: number;
  label: string;
  unavailableLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let widgetId: string | null = null;
    let poll: ReturnType<typeof setInterval> | undefined;
    let giveUp: ReturnType<typeof setTimeout> | undefined;

    const mount = (): boolean => {
      const turnstile = getTurnstile();
      const container = containerRef.current;
      if (!turnstile || !container || cancelled) {
        return false;
      }

      widgetId = turnstile.render(container, {
        sitekey: siteKey,
        action: 'register',
        theme: 'auto',
        callback: (token) => onToken(token),
        'expired-callback': () => onToken(null),
        'timeout-callback': () => onToken(null),
        'error-callback': () => {
          onToken(null);
          setFailed(true);
        },
      });
      if (giveUp) {
        clearTimeout(giveUp);
        giveUp = undefined;
      }
      setFailed(false);
      return true;
    };

    if (!mount()) {
      poll = setInterval(() => {
        if (mount() && poll) {
          clearInterval(poll);
          poll = undefined;
        }
      }, 200);
      giveUp = setTimeout(() => {
        if (poll) {
          clearInterval(poll);
          poll = undefined;
        }
        if (!cancelled) {
          setFailed(true);
        }
      }, 15_000);
    }

    return () => {
      cancelled = true;
      if (poll) {
        clearInterval(poll);
      }
      if (giveUp) {
        clearTimeout(giveUp);
      }
      if (widgetId) {
        try {
          getTurnstile()?.remove(widgetId);
        } catch {
          // The widget may already be gone after a client-side unmount.
        }
      }
    };
  }, [siteKey, onToken, resetKey]);

  return (
    <div role="group" aria-label={label}>
      <Script
        src={TURNSTILE_SCRIPT}
        strategy="afterInteractive"
        onError={() => setFailed(true)}
      />
      <div ref={containerRef} className="min-h-[65px]" />
      {failed && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {unavailableLabel}
        </p>
      )}
    </div>
  );
}

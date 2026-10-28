'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { InteractionType, UserProfile } from '@openscroll/contracts';
import { ApiError, api } from '../lib/api-client';
import {
  isLocale,
  localeDirection,
  translate,
  type Locale,
  type TranslationKey,
} from '../lib/i18n';
import {
  flushInteractionQueue,
  queueInteraction,
  queuedInteractionCount,
} from '../lib/offline-queue';

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

const LOCALE_KEY = 'openscroll-locale';

function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    const stored = window.localStorage.getItem(LOCALE_KEY);
    const browser = navigator.language.split('-')[0] ?? 'en';
    const initial = stored && isLocale(stored) ? stored : isLocale(browser) ? browser : 'en';
    setLocaleState(initial);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = localeDirection(locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    window.localStorage.setItem(LOCALE_KEY, next);
  }, []);

  const t = useCallback(
    (key: TranslationKey, variables?: Record<string, string | number>) =>
      translate(locale, key, variables),
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useLocale must be used inside LocaleProvider');
  }
  return context;
}

type AuthStatus = 'loading' | 'authenticated' | 'guest';

interface AuthContextValue {
  status: AuthStatus;
  user: UserProfile | null;
  refresh: () => Promise<UserProfile | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<UserProfile | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<UserProfile | null> => {
    try {
      const response = await api<{ user: UserProfile }>('/api/v1/me');
      if (mounted.current) {
        setUser(response.user);
        setStatus('authenticated');
      }
      return response.user;
    } catch (error) {
      if (mounted.current) {
        setUser(null);
        setStatus('guest');
      }
      if (error instanceof ApiError && error.status === 401) {
        return null;
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => {
      if (mounted.current) {
        setStatus('guest');
      }
    });
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await api('/api/v1/auth/logout', { method: 'POST' });
    } catch {
      // Local sign-out must still work if the server session already expired.
    }
    if (mounted.current) {
      setUser(null);
      setStatus('guest');
    }
  }, []);

  const value = useMemo(
    () => ({ status, user, refresh, signOut }),
    [status, user, refresh, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}

type ToastTone = 'info' | 'success' | 'error';

interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, tone: ToastTone = 'info') => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    setItems((current) => [...current.slice(-2), { id, message, tone }]);
    window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, 4_500);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        role="status"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className={[
              'toast pointer-events-auto max-w-sm rounded-2xl border px-4 py-3 text-sm shadow-xl backdrop-blur',
              item.tone === 'success'
                ? 'border-success/30 bg-success/15 text-success'
                : item.tone === 'error'
                  ? 'border-danger/30 bg-danger/15 text-danger'
                  : 'border-line bg-elevated/95 text-ink',
            ].join(' ')}
          >
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside ToastProvider');
  }
  return context;
}

interface OfflineContextValue {
  online: boolean;
  pending: number;
  enqueue: (
    cardId: string,
    interactionType: InteractionType,
    dwellTimeMs?: number,
  ) => Promise<'sent' | 'queued'>;
  flush: () => Promise<void>;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

function OfflineProvider({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  const { toast } = useToast();
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);

  const refreshCount = useCallback(async () => {
    setPending(await queuedInteractionCount());
  }, []);

  const flush = useCallback(async () => {
    const result = await flushInteractionQueue();
    setPending(result.remaining);
    if (result.sent > 0) {
      toast(t('allSynced'), 'success');
    }
  }, [t, toast]);

  const enqueue = useCallback(
    async (
      cardId: string,
      interactionType: InteractionType,
      dwellTimeMs = 0,
    ): Promise<'sent' | 'queued'> => {
      const result = await queueInteraction({
        cardId,
        interactionType,
        dwellTimeMs,
      });
      await refreshCount();
      return result;
    },
    [refreshCount],
  );

  useEffect(() => {
    setOnline(navigator.onLine);
    refreshCount().catch(() => undefined);

    const handleOnline = () => {
      setOnline(true);
      flush().catch(() => undefined);
    };
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    if (navigator.onLine) {
      flush().catch(() => undefined);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [flush, refreshCount]);

  const value = useMemo(
    () => ({ online, pending, enqueue, flush }),
    [online, pending, enqueue, flush],
  );
  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline(): OfflineContextValue {
  const context = useContext(OfflineContext);
  if (!context) {
    throw new Error('useOffline must be used inside OfflineProvider');
  }
  return context;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <LocaleProvider>
        <AuthProvider>
          <OfflineProvider>{children}</OfflineProvider>
        </AuthProvider>
      </LocaleProvider>
    </ToastProvider>
  );
}

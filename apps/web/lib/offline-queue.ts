import type { InteractionType } from '@openscroll/contracts';
import { ApiError, api, isNetworkError } from './api-client';
import { newIdempotencyKey } from './utils';

const DB_NAME = 'openscroll-offline';
const DB_VERSION = 1;
const STORE = 'interactions';

export interface QueuedInteraction {
  id: string;
  cardId: string;
  interactionType: InteractionType;
  dwellTimeMs: number;
  idempotencyKey: string;
  createdAt: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available'));
  }
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB failed'));
  });
  return dbPromise;
}

function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = action(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB failed'));
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      }),
  );
}

export async function queuedInteractionCount(): Promise<number> {
  try {
    return await transaction<number>('readonly', (store) => store.count());
  } catch {
    return 0;
  }
}

async function allQueued(): Promise<QueuedInteraction[]> {
  const rows = await transaction<QueuedInteraction[]>(
    'readonly',
    (store) => store.getAll(),
  );
  return rows.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

async function putQueued(entry: QueuedInteraction): Promise<void> {
  await transaction('readwrite', (store) => store.put(entry));
}

async function removeQueued(id: string): Promise<void> {
  await transaction('readwrite', (store) => store.delete(id));
}

async function sendInteraction(entry: QueuedInteraction): Promise<void> {
  await api(`/api/v1/cards/${entry.cardId}/interaction`, {
    method: 'POST',
    body: {
      interaction_type: entry.interactionType,
      dwell_time_ms: entry.dwellTimeMs,
    },
    headers: { 'idempotency-key': entry.idempotencyKey },
  });
}

export async function queueInteraction(input: {
  cardId: string;
  interactionType: InteractionType;
  dwellTimeMs?: number;
}): Promise<'sent' | 'queued'> {
  const entry: QueuedInteraction = {
    id: newIdempotencyKey('queue'),
    cardId: input.cardId,
    interactionType: input.interactionType,
    dwellTimeMs: Math.min(300_000, Math.max(0, Math.round(input.dwellTimeMs ?? 0))),
    idempotencyKey: newIdempotencyKey('interaction'),
    createdAt: new Date().toISOString(),
  };

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    await putQueued(entry);
    return 'queued';
  }

  try {
    await sendInteraction(entry);
    return 'sent';
  } catch (error) {
    if (isNetworkError(error)) {
      await putQueued(entry);
      return 'queued';
    }
    throw error;
  }
}

export async function flushInteractionQueue(): Promise<{
  sent: number;
  remaining: number;
}> {
  const entries = await allQueued();
  let sent = 0;

  for (const entry of entries) {
    try {
      await sendInteraction(entry);
      await removeQueued(entry.id);
      sent += 1;
    } catch (error) {
      if (isNetworkError(error)) {
        break;
      }
      if (error instanceof ApiError) {
        if (error.status === 401 || error.status === 429) {
          break;
        }
        if (error.status >= 400 && error.status < 500) {
          await removeQueued(entry.id);
          continue;
        }
      }
      break;
    }
  }

  return { sent, remaining: await queuedInteractionCount() };
}

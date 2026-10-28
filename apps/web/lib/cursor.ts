import { HttpError } from './http';

export interface TimeCursor {
  createdAt: string;
  id: string;
}

function encode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function decode(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(padding));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

export function encodeTimeCursor(cursor: TimeCursor): string {
  return encode(JSON.stringify(cursor));
}

export function decodeTimeCursor(value: string): TimeCursor {
  if (!value || value.length > 1_024) {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid cursor');
  }

  try {
    const parsed = JSON.parse(decode(value)) as Partial<TimeCursor>;
    const date = parsed.createdAt ? new Date(parsed.createdAt) : null;
    if (
      !date ||
      Number.isNaN(date.getTime()) ||
      typeof parsed.id !== 'string' ||
      parsed.id.length === 0 ||
      parsed.id.length > 100
    ) {
      throw new Error('invalid cursor');
    }
    return { createdAt: date.toISOString(), id: parsed.id };
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid cursor');
  }
}

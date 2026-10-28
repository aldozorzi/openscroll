import { HttpError } from './http';

export function requireIdempotencyKey(request: Request): string {
  const value = request.headers.get('idempotency-key')?.trim();
  if (!value || value.length > 255) {
    throw new HttpError(
      400,
      'BAD_REQUEST',
      'Idempotency-Key header must contain between 1 and 255 characters',
    );
  }
  return value;
}

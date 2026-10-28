import { ProviderResponseError } from './errors';

export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(withoutFence) as unknown;
  } catch (error) {
    throw new ProviderResponseError('Provider returned invalid JSON content', {
      cause: error,
    });
  }
}

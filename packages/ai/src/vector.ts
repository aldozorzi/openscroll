import { AiError } from './errors';

export function normalizeVector(vector: number[]): number[] {
  if (vector.length === 0) {
    throw new AiError('Cannot normalize an empty vector', 'INVALID_VECTOR');
  }

  let sumSquares = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new AiError('Vector contains a non-finite value', 'INVALID_VECTOR');
    }
    sumSquares += value * value;
  }

  const norm = Math.sqrt(sumSquares);
  if (norm === 0) {
    throw new AiError('Cannot normalize a zero vector', 'INVALID_VECTOR');
  }

  return vector.map((value) => value / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new AiError('Vectors must have the same dimensions', 'INVALID_VECTOR');
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

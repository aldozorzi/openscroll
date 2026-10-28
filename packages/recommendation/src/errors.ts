export class RecommendationError extends Error {
  readonly code: string;

  constructor(message: string, code = 'RECOMMENDATION_ERROR') {
    super(message);
    this.name = 'RecommendationError';
    this.code = code;
  }
}

export class InvalidCursorError extends RecommendationError {
  constructor(message = 'Invalid feed cursor') {
    super(message, 'INVALID_CURSOR');
    this.name = 'InvalidCursorError';
  }
}

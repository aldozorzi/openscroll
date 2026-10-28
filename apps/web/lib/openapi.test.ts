import { describe, expect, it } from 'vitest';
import { createOpenApiDocument } from './openapi';

describe('OpenAPI document', () => {
  it('generates a serializable OpenAPI 3.1 document from contracts', () => {
    const document = createOpenApiDocument();
    expect(document.openapi).toBe('3.1.0');
    expect(document.info).toMatchObject({ title: 'OpenScroll API' });

    const components = document.components as {
      schemas: Record<string, Record<string, unknown>>;
    };
    expect(components.schemas.AuthResponse).toBeDefined();
    expect(components.schemas.FeedResponse).toBeDefined();
    expect(components.schemas.AuthResponse?.$schema).toBeUndefined();

    const paths = document.paths as Record<string, unknown>;
    expect(paths['/api/v1/auth/register']).toBeDefined();
    expect(paths['/api/v1/auth/verify-email']).toBeDefined();
    expect(paths['/api/v1/auth/resend-verification']).toBeDefined();
    expect(paths['/api/v1/cards/{id}/review']).toBeDefined();
    expect(paths['/api/v1/auth/forgot-password']).toBeDefined();
    expect(paths['/api/v1/auth/reset-password']).toBeDefined();
    expect(paths['/api/v1/sources/import/opml']).toBeDefined();

    const register = paths['/api/v1/auth/register'] as {
      post: { responses: Record<string, unknown> };
    };
    expect(register.post.responses['202']).toBeDefined();
    expect(register.post.responses['201']).toBeUndefined();

    expect(() => JSON.stringify(document)).not.toThrow();
  });
});

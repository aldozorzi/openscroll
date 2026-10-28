import { z, type ZodType } from 'zod';
import {
  ApiErrorSchema,
  AuthResponseSchema,
  FeedResponseSchema,
  ForgotPasswordSchema,
  InteractionSchema,
  LoginSchema,
  PreferencesResponseSchema,
  PreferencesSchema,
  RegisterSchema,
  ResendVerificationSchema,
  ResetPasswordSchema,
  ReviewSchema,
  SourceInputSchema,
  SourceSchema,
  UserProfileSchema,
  VerifyEmailSchema,
} from '@openscroll/contracts';
import { getServerEnv } from '@openscroll/config';

type JsonSchema = Record<string, unknown>;

function jsonSchema(schema: ZodType): JsonSchema {
  const generated = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
  }) as JsonSchema;
  const { $schema: _schema, ...rest } = generated;
  return rest;
}

const errorRef = { $ref: '#/components/schemas/ApiError' };

function body(schema: string): JsonSchema {
  return {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: `#/components/schemas/${schema}` },
      },
    },
  };
}

function response(description: string, schema?: string): JsonSchema {
  return {
    description,
    ...(schema
      ? {
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${schema}` },
            },
          },
        }
      : {}),
  };
}

const authErrors = {
  '401': { description: 'Authentication required' },
  '403': { description: 'CSRF or origin check failed' },
  '429': { description: 'Rate limited' },
};

const idempotencyHeader = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  schema: { type: 'string', minLength: 1, maxLength: 255 },
};

const operation = (
  summary: string,
  options: {
    security?: Array<Record<string, string[]>>;
    schema?: string;
    responses?: Record<string, JsonSchema>;
  } = {},
): JsonSchema => ({
  summary,
  ...(options.security ? { security: options.security } : {}),
  ...(options.schema ? { requestBody: body(options.schema) } : {}),
  responses: options.responses ?? {},
});

export function createOpenApiDocument(): JsonSchema {
  const env = getServerEnv();
  return {
    openapi: '3.1.0',
    info: {
      title: 'OpenScroll API',
      version: '1.0.0',
      description:
        'API for personalized learning cards, spaced review, feeds, and source management.',
    },
    servers: [{ url: env.NEXT_PUBLIC_APP_URL }],
    tags: [
      { name: 'auth' },
      { name: 'account' },
      { name: 'feed' },
      { name: 'cards' },
      { name: 'sources' },
      { name: 'admin' },
      { name: 'system' },
    ],
    components: {
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'openscroll_session' },
        adminToken: { type: 'http', scheme: 'bearer' },
      },
      schemas: {
        ApiError: jsonSchema(ApiErrorSchema),
        RegisterInput: jsonSchema(RegisterSchema),
        LoginInput: jsonSchema(LoginSchema),
        ForgotPasswordInput: jsonSchema(ForgotPasswordSchema),
        ResetPasswordInput: jsonSchema(ResetPasswordSchema),
        VerifyEmailInput: jsonSchema(VerifyEmailSchema),
        ResendVerificationInput: jsonSchema(ResendVerificationSchema),
        AuthResponse: jsonSchema(AuthResponseSchema),
        UserProfile: jsonSchema(UserProfileSchema),
        PreferencesInput: jsonSchema(PreferencesSchema),
        PreferencesResponse: jsonSchema(PreferencesResponseSchema),
        FeedResponse: jsonSchema(FeedResponseSchema),
        InteractionInput: jsonSchema(InteractionSchema),
        ReviewInput: jsonSchema(ReviewSchema),
        SourceInput: jsonSchema(SourceInputSchema),
        SourceRecord: jsonSchema(SourceSchema),
      },
    },
    paths: {
      '/api/v1/auth/register': {
        post: {
          ...operation(
            'Request an account. Always answers 202 and sends a verification link when the address is eligible; the account is unusable until the link is consumed. Requires a Turnstile token when CAPTCHA is enabled.',
            {
              schema: 'RegisterInput',
              responses: {
                '202': response('Registration request accepted'),
                '400': response('Generic registration failure'),
                '429': response('Rate limited'),
                '503': response('Registration is temporarily unavailable'),
              },
            },
          ),
          tags: ['auth'],
        },
      },
      '/api/v1/auth/login': {
        post: {
          ...operation('Sign in', {
            schema: 'LoginInput',
            responses: {
              '200': response('Signed in', 'AuthResponse'),
              '401': response('Invalid credentials, or email not verified'),
              '429': response('Rate limited'),
            },
          }),
          tags: ['auth'],
        },
      },
      '/api/v1/auth/forgot-password': {
        post: {
          ...operation('Request a password reset email', {
            schema: 'ForgotPasswordInput',
            responses: {
              '202': response('Reset email requested'),
              '429': response('Rate limited'),
            },
          }),
          tags: ['auth'],
        },
      },
      '/api/v1/auth/reset-password': {
        post: {
          ...operation('Reset a password with a one-time token', {
            schema: 'ResetPasswordInput',
            responses: {
              '200': response('Password reset and signed in', 'AuthResponse'),
              '400': response('Invalid or expired reset token'),
              '429': response('Rate limited'),
            },
          }),
          tags: ['auth'],
        },
      },
      '/api/v1/auth/verify-email': {
        post: {
          ...operation('Consume a one-time email verification token with the registration password, then sign in', {
            schema: 'VerifyEmailInput',
            responses: {
              '200': response('Email verified and signed in', 'AuthResponse'),
              '400': response('Invalid or expired verification token, or wrong password'),
              '429': response('Rate limited'),
            },
          }),
          tags: ['auth'],
        },
      },
      '/api/v1/auth/resend-verification': {
        post: {
          ...operation(
            'Request a new verification email. Always answers 202 and never reveals whether an account exists. Requires a Turnstile token when CAPTCHA is enabled.',
            {
              schema: 'ResendVerificationInput',
              responses: {
                '202': response('Verification request accepted'),
                '400': response('Generic verification-email failure'),
                '429': response('Rate limited'),
                '503': response('Verification email is temporarily unavailable'),
              },
            },
          ),
          tags: ['auth'],
        },
      },
      '/api/v1/auth/refresh': {
        post: {
          ...operation('Rotate the current session', {
            security: [{ sessionCookie: [] }],
            responses: {
              '200': response('Session rotated', 'AuthResponse'),
              ...authErrors,
            },
          }),
          tags: ['auth'],
        },
      },
      '/api/v1/auth/logout': {
        post: {
          ...operation('Revoke the current session', {
            security: [{ sessionCookie: [] }],
            responses: { '204': { description: 'Signed out' }, ...authErrors },
          }),
          tags: ['auth'],
        },
      },
      '/api/v1/me': {
        get: {
          ...operation('Get the current profile', {
            security: [{ sessionCookie: [] }],
            responses: {
              '200': response('Profile', 'AuthResponse'),
              ...authErrors,
            },
          }),
          tags: ['account'],
        },
        delete: {
          ...operation('Delete the account and all user data', {
            security: [{ sessionCookie: [] }],
            responses: { '204': { description: 'Account deleted' }, ...authErrors },
          }),
          tags: ['account'],
        },
      },
      '/api/v1/user/preferences': {
        put: {
          ...operation('Replace learning preferences', {
            security: [{ sessionCookie: [] }],
            schema: 'PreferencesInput',
            responses: {
              '200': response('Preferences updated', 'PreferencesResponse'),
              ...authErrors,
            },
          }),
          tags: ['account'],
        },
      },
      '/api/v1/me/saved': {
        get: {
          ...operation('List saved cards', {
            security: [{ sessionCookie: [] }],
            responses: {
              '200': response('Saved cards'),
              ...authErrors,
            },
          }),
          tags: ['account'],
        },
      },
      '/api/v1/me/export': {
        get: {
          ...operation('Export all user data as JSON', {
            security: [{ sessionCookie: [] }],
            responses: {
              '200': {
                description: 'JSON export',
                headers: {
                  'content-disposition': {
                    schema: { type: 'string' },
                  },
                },
                content: {
                  'application/json': { schema: { type: 'object' } },
                },
              },
              ...authErrors,
            },
          }),
          tags: ['account'],
        },
      },
      '/api/v1/feed': {
        get: {
          ...operation('Get a personalized feed page', {
            security: [{ sessionCookie: [] }],
            responses: {
              '200': response('Feed page', 'FeedResponse'),
              ...authErrors,
            },
          }),
          parameters: [
            {
              name: 'mode',
              in: 'query',
              schema: { type: 'string', enum: ['learn', 'review', 'mixed'] },
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
            },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
          ],
          tags: ['feed'],
        },
      },
      '/api/v1/cards/{id}': {
        get: {
          ...operation('Get card details', {
            security: [{ sessionCookie: [] }],
            responses: {
              '200': response('Card'),
              ...authErrors,
              '404': response('Card not found'),
            },
          }),
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          tags: ['cards'],
        },
      },
      '/api/v1/cards/{id}/interaction': {
        post: {
          ...operation('Record a card interaction', {
            security: [{ sessionCookie: [] }],
            schema: 'InteractionInput',
            responses: {
              '200': response('Interaction already recorded'),
              '201': response('Interaction recorded'),
              ...authErrors,
              '404': response('Card not found'),
            },
          }),
          parameters: [
            idempotencyHeader,
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          tags: ['cards'],
        },
      },
      '/api/v1/cards/{id}/review': {
        post: {
          ...operation('Submit a spaced-repetition review', {
            security: [{ sessionCookie: [] }],
            schema: 'ReviewInput',
            responses: {
              '200': response('Review recorded'),
              '409': response('Idempotency conflict'),
              ...authErrors,
              '404': response('Card not found'),
            },
          }),
          parameters: [
            idempotencyHeader,
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          tags: ['cards'],
        },
      },
      '/api/v1/sources': {
        get: {
          ...operation('List accessible sources', {
            security: [{ sessionCookie: [] }],
            responses: { '200': response('Sources'), ...authErrors },
          }),
          tags: ['sources'],
        },
        post: {
          ...operation('Discover and add a feed source', {
            security: [{ sessionCookie: [] }],
            schema: 'SourceInput',
            responses: {
              '202': response('Source added and ingestion queued', 'SourceRecord'),
              ...authErrors,
              '400': response('No feed found'),
            },
          }),
          tags: ['sources'],
        },
      },
      '/api/v1/sources/{id}': {
        get: {
          ...operation('Get a source', {
            security: [{ sessionCookie: [] }],
            responses: {
              '200': response('Source', 'SourceRecord'),
              ...authErrors,
              '404': response('Source not found'),
            },
          }),
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          tags: ['sources'],
        },
        delete: {
          ...operation('Delete an owned source', {
            security: [{ sessionCookie: [] }],
            responses: {
              '200': response('Source deleted'),
              ...authErrors,
              '403': response('Not the source owner'),
              '404': response('Source not found'),
            },
          }),
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          tags: ['sources'],
        },
      },
      '/api/v1/sources/{id}/status': {
        get: {
          ...operation('Get ingestion status for a source', {
            security: [{ sessionCookie: [] }],
            responses: { '200': response('Source status'), ...authErrors },
          }),
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          tags: ['sources'],
        },
      },
      '/api/v1/sources/{id}/subscribe': {
        post: {
          ...operation('Subscribe to a source', {
            security: [{ sessionCookie: [] }],
            responses: { '200': response('Subscribed'), ...authErrors },
          }),
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          tags: ['sources'],
        },
        delete: {
          ...operation('Unsubscribe from a source', {
            security: [{ sessionCookie: [] }],
            responses: { '204': { description: 'Unsubscribed' }, ...authErrors },
          }),
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          tags: ['sources'],
        },
      },
      '/api/v1/sources/import/opml': {
        post: {
          ...operation('Import OPML subscriptions', {
            security: [{ sessionCookie: [] }],
            responses: {
              '202': response('Subscriptions imported'),
              ...authErrors,
              '400': response('Invalid OPML'),
            },
          }),
          tags: ['sources'],
        },
      },
      '/api/v1/health': {
        get: {
          ...operation('Database health check', {
            responses: {
              '200': response('Healthy'),
              '503': response('Database unavailable'),
            },
          }),
          tags: ['system'],
        },
      },
      '/api/v1/admin/ingest': {
        post: {
          ...operation('Queue ingestion for one or all sources', {
            security: [{ adminToken: [] }],
            responses: {
              '202': response('Ingestion queued'),
              '401': { description: 'Invalid admin token' },
            },
          }),
          tags: ['admin'],
        },
      },
      '/api/v1/admin/usage': {
        get: {
          ...operation('Get provider usage and budget limits', {
            security: [{ adminToken: [] }],
            responses: {
              '200': response('Usage'),
              '401': { description: 'Invalid admin token' },
            },
          }),
          tags: ['admin'],
        },
      },
      '/api/v1/admin/reembed': {
        post: {
          ...operation('Queue user-vector recomputation', {
            security: [{ adminToken: [] }],
            responses: {
              '202': response('Re-embedding queued'),
              '401': { description: 'Invalid admin token' },
            },
          }),
          tags: ['admin'],
        },
      },
    },
  };
}

export const openApiDocument = createOpenApiDocument;

export { errorRef };

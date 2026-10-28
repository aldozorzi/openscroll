import { describe, expect, it } from 'vitest';
import { RegisterSchema } from './auth';

const base = {
  email: 'user@example.com',
  password: 'correct horse battery',
};

describe('RegisterSchema', () => {
  it('accepts a registration without a CAPTCHA token', () => {
    expect(RegisterSchema.safeParse(base).success).toBe(true);
  });

  it('accepts and trims a Turnstile token', () => {
    const parsed = RegisterSchema.parse({ ...base, captcha_token: ' token ' });
    expect(parsed.captcha_token).toBe('token');
  });

  it('rejects an oversized CAPTCHA token', () => {
    const result = RegisterSchema.safeParse({
      ...base,
      captcha_token: 'x'.repeat(2049),
    });
    expect(result.success).toBe(false);
  });
});

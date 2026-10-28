import { z } from 'zod';
import { PreferencesSchema } from './preferences';

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(255));

const captchaTokenSchema = z
  .string()
  .trim()
  .max(2048)
  .optional();

export const RegisterSchema = z.object({
  email: emailSchema,
  password: z.string().min(12).max(128),
  // Cloudflare Turnstile token. Optional in the schema so the route can decide
  // whether it is required for the current environment.
  captcha_token: captchaTokenSchema,
});

export type RegisterInput = z.infer<typeof RegisterSchema>;

export const VerifyEmailSchema = z.object({
  token: z.string().trim().min(32).max(512),
  // The password chosen at registration. Requiring it means that merely
  // clicking the link cannot activate a password chosen by someone else.
  password: z.string().min(1).max(128),
});

export type VerifyEmailInput = z.infer<typeof VerifyEmailSchema>;

export const ResendVerificationSchema = z.object({
  email: emailSchema,
  captcha_token: captchaTokenSchema,
});

export type ResendVerificationInput = z.infer<typeof ResendVerificationSchema>;

export const LoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export type LoginInput = z.infer<typeof LoginSchema>;

export const ForgotPasswordSchema = z.object({
  email: emailSchema,
});

export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

export const ResetPasswordSchema = z.object({
  token: z.string().trim().min(32).max(512),
  password: z.string().min(12).max(128),
});

export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

export const PreferencesResponseSchema = PreferencesSchema.extend({
  updated_at: z.string(),
});

export type PreferencesResponse = z.infer<typeof PreferencesResponseSchema>;

export const UserProfileSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: z.enum(['user', 'admin']),
  created_at: z.string(),
  user_vector_updated_at: z.string().nullable(),
  preferences: PreferencesResponseSchema.nullable(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

export const AuthResponseSchema = z.object({
  user: UserProfileSchema,
});

export type AuthResponse = z.infer<typeof AuthResponseSchema>;

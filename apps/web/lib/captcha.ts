import { getServerEnv } from '@openscroll/config';
import { logSecurityEvent } from './security-log';

const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_TIMEOUT_MS = 5_000;

export const TURNSTILE_ACTION = 'register';
export const TURNSTILE_MAX_TOKEN_LENGTH = 2048;

export type CaptchaMode = 'enforce' | 'observe' | 'disabled' | 'unavailable';

export interface CaptchaEnv {
  NODE_ENV: 'development' | 'test' | 'production';
  TURNSTILE_SITE_KEY?: string | null;
  TURNSTILE_SECRET_KEY?: string | null;
}

export interface CaptchaConfig {
  siteKey: string | null;
  secretKey: string | null;
  configured: boolean;
  mode: CaptchaMode;
}

/**
 * Resolve the CAPTCHA policy from the environment.
 *
 * - production + keys: enforce (fail closed)
 * - production without keys: registration is unavailable (503)
 * - development + keys: observe (render/verify, but never block)
 * - development/test without keys, or tests: disabled
 */
export function getCaptchaConfig(
  env: CaptchaEnv = getServerEnv(),
): CaptchaConfig {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim() || null;
  const secretKey = env.TURNSTILE_SECRET_KEY?.trim() || null;
  const configured = Boolean(siteKey && secretKey);

  let mode: CaptchaMode;
  if (env.NODE_ENV === 'test') {
    // Tests must stay hermetic: never call Cloudflare from the test suite.
    mode = 'disabled';
  } else if (env.NODE_ENV === 'production') {
    mode = configured ? 'enforce' : 'unavailable';
  } else {
    mode = configured ? 'observe' : 'disabled';
  }

  return { siteKey, secretKey, configured, mode };
}

export type CaptchaFailureReason =
  | 'missing_token'
  | 'invalid_token'
  | 'action_mismatch'
  | 'provider_error'
  | 'timeout';

export interface CaptchaVerification {
  ok: boolean;
  reason?: CaptchaFailureReason;
}

export type CaptchaFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface VerifyOptions {
  secretKey: string;
  remoteIp?: string | null;
  fetchImpl?: CaptchaFetcher;
  timeoutMs?: number;
}

export async function verifyTurnstileToken(
  token: string | undefined,
  options: VerifyOptions,
): Promise<CaptchaVerification> {
  const response = token?.trim();
  if (!response || response.length > TURNSTILE_MAX_TOKEN_LENGTH) {
    return { ok: false, reason: 'missing_token' };
  }

  const form = new URLSearchParams({
    secret: options.secretKey,
    response,
  });
  if (options.remoteIp) {
    form.set('remoteip', options.remoteIp);
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const result = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      cache: 'no-store',
      signal: AbortSignal.timeout(options.timeoutMs ?? TURNSTILE_TIMEOUT_MS),
    });

    if (!result.ok) {
      return { ok: false, reason: 'provider_error' };
    }

    const body = (await result.json()) as {
      success?: unknown;
      action?: unknown;
    };
    if (body.success !== true) {
      return { ok: false, reason: 'invalid_token' };
    }
    // Turnstile echoes the action configured on the widget. Only reject when
    // the provider returned one and it belongs to another flow.
    if (typeof body.action === 'string' && body.action !== TURNSTILE_ACTION) {
      return { ok: false, reason: 'action_mismatch' };
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'provider_error' };
  }
}

export type CaptchaDecision =
  | { action: 'allow' }
  | { action: 'reject'; reason: CaptchaFailureReason }
  | { action: 'unavailable' };

interface CheckOptions {
  env?: CaptchaEnv;
  fetchImpl?: CaptchaFetcher;
}

/**
 * Decide whether a registration may proceed. Verification happens before any
 * user lookup so a failed CAPTCHA never reaches the account-enumeration oracle.
 */
export async function checkRegistrationCaptcha(
  token: string | undefined,
  remoteIp: string | null,
  options: CheckOptions = {},
): Promise<CaptchaDecision> {
  const config = getCaptchaConfig(options.env ?? getServerEnv());

  if (config.mode === 'disabled') {
    return { action: 'allow' };
  }
  if (config.mode === 'unavailable' || !config.secretKey) {
    return { action: 'unavailable' };
  }

  const verification = await verifyTurnstileToken(token, {
    secretKey: config.secretKey,
    remoteIp,
    fetchImpl: options.fetchImpl,
  });

  if (verification.ok) {
    return { action: 'allow' };
  }

  if (config.mode === 'observe') {
    // Development only: surface the problem in logs without locking developers
    // (and automated UI checks) out when the widget misbehaves.
    logSecurityEvent('auth_register_captcha_bypassed', {
      ip: remoteIp,
      reason: verification.reason,
    });
    return { action: 'allow' };
  }

  return {
    action: 'reject',
    reason: verification.reason ?? 'invalid_token',
  };
}

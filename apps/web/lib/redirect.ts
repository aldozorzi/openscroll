/**
 * Restrict post-login redirects to same-origin absolute paths. Reject
 * protocol-relative ("//evil.example"), backslash variants that browsers may
 * normalize to another origin, and control characters.
 */
export function safeRedirectPath(
  value: string | undefined,
  fallback = '/feed',
): string {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fallback;
  }
  return value;
}

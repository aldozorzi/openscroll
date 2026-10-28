# Security and privacy

This checklist covers the requirements in SPECS sections 10 and 13. It describes
what the code enforces, how to verify it, and remaining operational risks.

## Application security

### SSRF

All user-supplied URLs go through `safeFetch`. It resolves DNS, blocks private,
loopback, link-local, multicast, unspecified, and metadata addresses, pins the
connection to validated addresses, re-validates every redirect, caps response
size, and applies timeouts. RSS discovery uses the same guard.

Verification: `packages/ingest/src/ssrf.test.ts` covers private IPv4/IPv6,
metadata endpoints, mapped addresses, and private redirect targets.

### XSS and content rendering

Extracted HTML is sanitized before storage and cards render as text or sanitized
markup. No untrusted HTML is injected with `dangerouslySetInnerHTML`. The only
inline script is the theme bootstrap, protected by a per-request CSP nonce.

Verification: ingest extraction/sanitization tests and the hardened CSP unit
tests.

### Prompt injection

Article content is delimited in the prompt, tools are never exposed to the
generation model, metadata interpolated into the prompt is sanitized and length
capped, and output is validated with Zod before persistence.

Verification: `packages/ai/src/prompt.test.ts` and
`packages/ai/src/generate-card.test.ts`.

### Input validation

Every request body and query string is parsed with a Zod schema before use; no
handler uses a raw body or query value without schema validation. This includes auth payloads,
preferences, feed/saved cursors, source creation, card interactions and reviews,
and all admin actions. JSON bodies are capped at 1 MiB by the shared HTTP layer;
path IDs are validated as UUIDs; `Idempotency-Key` is limited to 255 characters;
time cursors are limited to 1,024 characters; the Turnstile token is limited to
2,048 characters; source URLs are limited to 2,048
characters and must use `http`/`https`; titles, categories, and search terms have
explicit maximum lengths. Admin filters accept only `true`/`false` (never a
truthy coercion of the string `"false"`) and only canonical source-type values.
Inputs that fail validation return `400` before any database or network work.

Feed and OPML ingestion is treated as untrusted input even though it comes from
workers:

- OPML web uploads are capped at 1 MiB and 100 feeds; the CLI caps downloads at
  5 MiB and parses at most 10,000 feeds. Both parsers reject `DOCTYPE`
  declarations (blocking entity expansion), cap nesting depth at 32 and
  per-file node counts, and ignore malformed or over-long URLs.
- JSON Feed parsing verifies that the root is an object and that `items` is an
  array, skips non-object items, ignores non-string fields, and caps titles,
  authors, languages, summaries, descriptions, IDs, and URLs. RSS/Atom fields
  receive the same caps.
- Article extraction caps stored title, byline, and language before persistence;
  the fetched HTML itself is already bounded to 5 MiB by `safeFetch`.
- Prompt metadata (title, URL, language) is stripped of control characters and
  angle brackets and truncated before interpolation; article content is capped
  separately.
- The queue webhook validates the job name and the per-job payload shape
  (UUID fields, optional ISO timestamp) before invoking a handler, so a valid
  shared secret does not by itself allow arbitrary handler input.
- The post-login `next` parameter is restricted to same-origin absolute paths;
  protocol-relative, backslash, and control-character variants fall back to
  `/feed`.

Verification: `packages/contracts/src/*.test.ts`,
`packages/ingest/src/{url,feed,opml}.test.ts`, `apps/web/lib/opml.test.ts`,
`apps/web/lib/redirect.test.ts`, `packages/ai/src/{prompt,relevance}.test.ts`,
`packages/queue/src/http-queue.test.ts`, and the API integration tests.

### Authentication

Sessions are opaque random tokens stored as SHA-256 hashes; the cookie is
HttpOnly, SameSite=Lax, and Secure in production. Login failures always return
the same `401 Invalid email or password`, and unknown accounts still pay for a
full Argon2 verification against a dummy hash, so response content and timing do
not reveal whether an address is registered. Login is limited per IP
(10/minute) and per account (10/15 minutes).

Registration never authenticates. `POST /api/v1/auth/register` always returns
`202 { "ok": true }` with no cookies. It verifies Turnstile before any account
lookup and pays for a full Argon2 hash regardless of whether the address exists,
so the same body, status and hashing cost apply to new, pending and verified
addresses. A new address creates an unverified account and a 256-bit token; an
existing unverified address replaces its password and outstanding token; an
existing verified address is left untouched and receives no mail. Because every
case is indistinguishable, registration is no longer an enumeration oracle.

Accounts are unusable until the emailed link is consumed by
`POST /api/v1/auth/verify-email`. Tokens are SHA-256 hashed at rest, single-use,
and valid for 24 hours. The endpoint also requires the password chosen at
registration. That closes the pre-hijacking variant in which an attacker
registers a victim's address with a password they know and relies on the victim
clicking the unsolicited link: the victim does not know the password, so the
token cannot be consumed, while the attacker never receives the email.
Verification revokes any session created before it and then creates a fresh one.
An unverified account cannot sign in, but login returns the same generic
`401 Invalid email or password` as a wrong password. A distinct `403` would let
an attacker register an address with a password of their choice and probe login:
`403` would mean the password took effect (the address was unverified), `401`
would mean it did not (the address was already verified). The sign-in screen
always offers a "need a verification email?" resend action, so unverified users
still have a path forward without the API revealing their state.
`POST /api/v1/auth/forgot-password` only sends reset links for verified
addresses.

Verification sends are budgeted in PostgreSQL so the limits hold across app
instances: a 60-second cooldown per address, 3 messages per address per 24
hours, and `VERIFICATION_EMAIL_DAILY_LIMIT` (default 50) globally. The budget
check and the account/token writes happen in one transaction under advisory
locks; when the budget is exhausted no account is created. Resends always return
`202`, are CAPTCHA-protected, and share the same per-address and global limits.
Migration `0005` backfills existing accounts as verified so the change does not
lock them out. The scheduled retention job deletes expired/used verification
tokens and send records older than 48 hours.

Set `RESEND_VERIFICATION_API_KEY` and `EMAIL_VERIFICATION_FROM` to isolate
verification traffic from password reset (`RESEND_API_KEY` / `EMAIL_FROM`). Both
fall back to the reset credentials when empty. Separate credentials and
senders/subdomains keep registration abuse from exhausting the reset quota or
damaging the reputation of the critical transactional stream. Monitor
bounce/complaint webhooks and pause verification sends when rates rise.

Registration is also protected by Cloudflare Turnstile. The token is verified
server-side against `siteverify`, with a 5-second timeout, `no-store`, and a
check that the challenge action is `register`. Verification runs before the
user lookup, so a failed challenge can never reach the enumeration oracle. In
production a missing or invalid token returns the same generic `400` as a wrong
password; if the Turnstile keys are absent, registration returns `503` instead
of silently disabling the challenge. Configuration requires both
`TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` (the pair is validated at
startup). In development the widget is rendered and verified, but a failed
challenge is logged (`auth_register_captcha_bypassed`) and allowed so local
flows keep working; the test environment skips the provider entirely.

Residual risk: the controls bound unwanted mail but do not eliminate it. An
attacker can still cause up to the daily cap of verification emails to arbitrary
addresses, and CAPTCHA solving is cheap, so the budget is the real control. Keep
registration and verification sends in abuse monitoring, alert on bounce and
complaint rates, and rotate the Resend keys if they leak. Someone who knows a
pending address can also re-register it before the owner does, which invalidates
the owner's outstanding link and password without giving the attacker access
(they still cannot read the mailbox). The owner can recover by requesting a new
link once the per-address cooldown expires; this is a narrow denial-of-service on
unverified sign-ups, not an account takeover.

Verification: `apps/web/lib/captcha.test.ts` covers the CAPTCHA policy matrix;
`apps/web/lib/verification.test.ts` covers the budget policy; and the API
integration tests exercise register → email → verify → login, uniform resend
responses, the resend cooldown, wrong verification passwords, single-use tokens,
and unverified-login blocking end to end.

### Authorization

Session-backed user routes scope queries by the authenticated user. The public
source catalog is shared, but private sources and their cards are limited to the
source owner. Adding a private feed URL creates an independent row scoped to the
owner, so two users may register the same private URL without sharing data or
receiving a conflict. The same rule is enforced by feed, card detail,
interactions, reviews, saved cards, source detail, source status, subscribe, and
delete. Admin routes require both a timing-safe `ADMIN_TOKEN` and an
authenticated session whose database role is `admin`; the `/admin` UI is
additionally restricted by role. GDPR export/delete only affect the current user.

Verification: API integration tests cover unauthenticated and cross-user access,
private-source isolation, cross-user private-URL coexistence, outsider delete
attempts, and admin rejection without a token or admin role.

### Password reset

Reset tokens are 256-bit random values stored only as SHA-256 hashes. They expire after 30 minutes, are single-use, and are invalidated when a new reset is requested. A successful reset revokes all existing sessions. Forgot-password always returns `202 { ok: true }` whether or not the address exists, and token creation plus email delivery run after the response so their latency is not observable. The endpoint is limited per IP (5/15 minutes) and per email (3/hour). Reset-password is limited per IP (10/15 minutes); invalid, expired, and already-used tokens all return the same `400`, and the invalid path performs an Argon2 hash to reduce timing differences.

Verification: `apps/web/test/api.integration.test.ts` covers token issuance, expiry/reuse rejection, session revocation, password rotation, uniform responses, and both rate limits.

### Rate limiting and CSRF

Auth, discovery, interaction, review, and admin routes use a fixed-window
limiter. Login, registration, password recovery, reset, source creation, and
OPML import have dedicated per-user/per-IP buckets. State-changing requests
validate the readable CSRF cookie against the `x-csrf-token` header and validate
`Origin` when present. Cookies are HttpOnly, SameSite=Lax, and Secure in
production.

Operational note: the limiter is in-process. A multi-instance deployment should
replace it with a shared Upstash/PostgreSQL limiter before relying on it for
abuse prevention.

### Secrets and logs

Environment validation rejects missing or weak required secrets. Request logs
contain method, path, status, duration, request ID, and error message, never
cookies, authorization headers, admin tokens, API keys, prompts, or article
content. Provider logs contain provider, model, operation, latency, token
counts, outcome, and error class.

Rotate `AUTH_SECRET` and `ADMIN_TOKEN` by replacing the value and restarting all
instances. Rotating `AUTH_SECRET` invalidates existing sessions by design.

### Headers and CORS

`proxy.ts` adds:

- Content-Security-Policy with a per-request script nonce and `strict-dynamic`
- HSTS for HTTPS requests
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` plus `frame-ancestors 'none'`
- `Referrer-Policy: strict-origin-when-cross-origin`
- restrictive `Permissions-Policy`
- `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy`

APIs do not emit `Access-Control-Allow-Origin`; browsers enforce same-origin
access. State-changing routes independently validate Origin and CSRF.

Verification: `apps/web/lib/security-headers.test.ts`.

### Dependencies

The lockfile is frozen in CI. `pnpm audit --prod --audit-level=high` runs in CI.
Review new packages for license, install scripts, and transitive weight.

Current production audit result: no known vulnerabilities.

## Privacy and retention

- Personal data export is available at `GET /api/v1/me/export`.
- Account deletion is available at `DELETE /api/v1/me`.
- Raw article content expires after 7 days and cleaned content after 30 days by
  default. Cards, embeddings, and attribution remain until removed or the user
  deletes the account.
- Provider usage records contain counts only, not prompts or article text.
- Analytics are not enabled by default and no third-party trackers are included.
- OAuth token encryption is not implemented because read-it-later OAuth is not
  part of the current feature set. Encrypt tokens before enabling that feature.

## Copyright and takedown

See [`CONTENT_POLICY.md`](./CONTENT_POLICY.md). The administrator takedown flow
is `POST /api/v1/admin/takedown` or the `/admin` UI. It hides every card for the
article, clears raw and cleaned content, and writes an `admin.takedown` audit log
entry. It deliberately keeps a minimal record for audit and attribution.

## AGPL-3.0

The full license is in [`LICENSE`](../LICENSE). The UI exposes a source link
configured by `NEXT_PUBLIC_SOURCE_URL`; operators must point it at the source for
their deployed version. Third-party notices are in [`NOTICE`](../NOTICE).

## Remaining hardening items

- Keep Turnstile in front of registration: it raises the cost of the remaining
  registration enumeration oracle but does not eliminate it. Revisit a mail-free
  uniform response if a better option (passkeys, invite codes) becomes viable.
- Replace the in-process rate limiter for multi-instance deployments.
- Use a secret manager rather than a `.env` file for production secrets.
- Put the worker webhook behind TLS and network policy when using QStash/Inngest.
- Review CSP `style-src 'unsafe-inline'` if a future UI removes inline styles.
- Add alerting for queue depth, repeated failures, quota thresholds, and
  database storage approaching the plan limit.

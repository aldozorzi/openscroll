# Personal deployment: Vercel Hobby + Neon + GitHub Actions

This is the zero-fixed-cost path. Vercel Hobby is for personal, non-commercial
use; move to a paid plan or the Docker topology before commercial use.

## 1. Neon

1. Create a Neon project and enable the `pgvector` extension.
2. Copy the pooled connection string into `DATABASE_URL`.
3. Copy the direct connection string into `DIRECT_URL`.
4. Run migrations from a trusted machine or CI:

```bash
DATABASE_URL=... DIRECT_URL=... pnpm db:migrate
```

Use the pooled URL for request-path queries. Use the direct URL for migrations
and all `pg-boss` operations.

## 2. Vercel

Import the repository, set the project root to `openscroll`, and configure:

```env
DATABASE_URL=<Neon pooled URL>
DIRECT_URL=<Neon direct URL>
AUTH_SECRET=<32+ random bytes>
CRON_SECRET=<32+ random bytes>
ADMIN_TOKEN=<32+ random bytes>
RESEND_API_KEY=re_...
EMAIL_FROM="OpenScroll <security@example.com>"
# Optional: isolate verification mail from password reset.
RESEND_VERIFICATION_API_KEY=re_...
EMAIL_VERIFICATION_FROM="OpenScroll <verify@example.com>"
VERIFICATION_EMAIL_DAILY_LIMIT=50
NEXT_PUBLIC_APP_URL=https://<your-domain>
NEXT_PUBLIC_SOURCE_URL=https://github.com/<you>/<your-fork>
TURNSTILE_SITE_KEY=<Turnstile site key>
TURNSTILE_SECRET_KEY=<Turnstile secret key>
# Vercel overwrites the forwarding headers, so per-IP limits are safe there.
TRUST_PROXY=true
LLM_PROVIDER=google
GOOGLE_GENERATIVE_AI_API_KEY=...
EMBEDDING_PROVIDER=cloudflare
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
LLM_DAILY_BUDGET_USD=0
```

For OpenRouter, replace the Google provider values with
`LLM_PROVIDER=openrouter`, `OPENROUTER_API_KEY=...`, and an `LLM_MODEL` such as
`nvidia/nemotron-3.5-super-vl:free`. Keep `EMBEDDING_PROVIDER=cloudflare`.

Registration is protected by Cloudflare Turnstile and sends a verification email before the account becomes usable. Set both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` and add your domain to the widget's allowed hostnames in the Turnstile dashboard. If the keys are missing in production, registration returns `503` rather than silently disabling the challenge; in development the widget is shown but a failed challenge is only logged.

A Resend key is required in production: without one, registration and resend requests return `503`. Set `RESEND_VERIFICATION_API_KEY` and `EMAIL_VERIFICATION_FROM` to a separate sender (ideally a subdomain) so registration abuse cannot exhaust the password-reset quota. `VERIFICATION_EMAIL_DAILY_LIMIT` caps verification sends across all addresses; keep it low enough that an abuse wave cannot burn your Resend quota. Configure bounce/complaint webhooks in Resend and monitor them.

`NEXT_PUBLIC_*` values are build-time. Redeploy after changing them. Do not add a
payment method to a free provider unless you intentionally accept paid overage;
OpenScroll is designed to fail closed instead.

## 3. GitHub Actions worker

Add repository secrets:

- `DATABASE_URL`, `DIRECT_URL`
- `AUTH_SECRET`, `CRON_SECRET`, `ADMIN_TOKEN`
- `RESEND_API_KEY`, `EMAIL_FROM` (web deployment; not required by the worker)
- `GOOGLE_GENERATIVE_AI_API_KEY` or `OPENROUTER_API_KEY`
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`

Add repository variables for model names, limits, and retention if you want to
override defaults. The checked-in `.github/workflows/worker.yml` runs
`pnpm worker:run` every 30 minutes with overlap prevention. For queue-based
processing closer to real time, move the worker to a long-lived container as
described in [`SCALING.md`](./SCALING.md).

## 4. Verify

```bash
curl -fsS https://<your-domain>/api/v1/health
```

Then register, add a source, and run the worker manually from the Actions tab.
Confirm a card appears in the feed and that `/admin` shows queue and provider
usage. Provider quota exhaustion should pause ingestion, not create charges.

## 5. Zero-cost checks

- `LLM_DAILY_BUDGET_USD=0`
- Article, LLM-token, and embedding-token caps set at or below the provider's
  free allowance
- No payment method attached to free providers
- Neon storage and compute alarms enabled
- GitHub Actions usage monitored
- Vercel usage acceptable for a personal instance

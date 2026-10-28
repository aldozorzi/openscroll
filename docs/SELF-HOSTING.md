# Self-hosting

OpenScroll runs as a Next.js standalone web container, a long-lived worker, and
PostgreSQL with `pgvector`. Docker Compose wires the three together, applies
migrations once, and keeps the database and optional Redis state in volumes.

## Requirements

- Docker Engine with Compose v2
- At least 2 GB of RAM and 2 CPU cores for the web build
- A public HTTPS domain for a production deployment
- Provider credentials, or `LLM_PROVIDER=mock` / `EMBEDDING_PROVIDER=mock` for a
  local evaluation

## First start

```bash
cp .env.example .env
# Replace AUTH_SECRET, CRON_SECRET, ADMIN_TOKEN, and any provider credentials.
# Generate secrets with: openssl rand -base64 32
docker compose up -d --build
```

Compose performs these steps in order:

1. Starts PostgreSQL and waits for its healthcheck.
2. Runs `pnpm db:migrate` in the one-shot `migrate` service.
3. Starts the standalone web app and the long-lived worker.

Check that the service is healthy:

```bash
curl -fsS http://localhost:3000/api/v1/health
docker compose ps
docker compose logs -f app worker
```

The UI is at `http://localhost:3000`. Admin operations are available at
`/admin` for users whose database role is `admin`; the page also requires the
`ADMIN_TOKEN` value from `.env`.

## Environment

Compose overrides `DATABASE_URL` and `DIRECT_URL` so both containers reach the
`db` service. Other values come from `.env`. Values prefixed with
`NEXT_PUBLIC_` are compiled into the web bundle, so rebuild the `app` image after
changing `NEXT_PUBLIC_APP_URL` or `NEXT_PUBLIC_SOURCE_URL`.

Useful defaults:

```env
QUEUE_DRIVER=pg-boss
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SOURCE_URL=https://github.com/openscroll/openscroll
LLM_PROVIDER=google
EMBEDDING_PROVIDER=cloudflare
LLM_DAILY_BUDGET_USD=0
```

Password reset email uses Resend. Set a verified sender before enabling it:

```env
RESEND_API_KEY=re_...
EMAIL_FROM="OpenScroll <security@example.com>"
```

Verification email is required for registration and can use a separate sender so abuse cannot exhaust the reset stream:

```env
RESEND_VERIFICATION_API_KEY=re_...
EMAIL_VERIFICATION_FROM="OpenScroll <verify@example.com>"
VERIFICATION_EMAIL_DAILY_LIMIT=50
```

`RESEND_VERIFICATION_API_KEY` and `EMAIL_VERIFICATION_FROM` fall back to `RESEND_API_KEY` / `EMAIL_FROM`. `VERIFICATION_EMAIL_DAILY_LIMIT` is the global 24-hour cap; in addition, each address gets one message every 60 seconds and at most three per day.

Without `RESEND_API_KEY`, production logs `password_reset_email_not_configured` and `verification_email_not_configured` and does not send mail; development logs the link. Registration returns `503` in production when no verification key is configured.

Registration uses Cloudflare Turnstile to slow down automated abuse:

```env
TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET_KEY=...
```

Both keys are required in production; if they are missing, `POST /api/v1/auth/register` returns `503`. In development the widget is rendered and verified, but a failed challenge is logged and does not block registration. Add your domain to the widget's allowed hostnames in the Turnstile dashboard.

Set `TRUST_PROXY=true` only when a trusted reverse proxy overwrites `X-Forwarded-For`, `X-Real-IP` or `CF-Connecting-IP`. Without it, all clients share the `unknown` IP bucket, so IP-based limits act as global limits; with it behind an untrusted proxy, clients can spoof their address and bypass those limits.

To use OpenRouter instead:

```env
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_APP_URL=https://scroll.example.com
OPENROUTER_APP_NAME=OpenScroll
LLM_MODEL=nvidia/nemotron-3.5-super-vl:free
```

Use a model whose OpenRouter metadata advertises `structured_outputs`; the
provider sends JSON mode and validates the response against the card schema.
Keep the `:free` suffix and set a spend limit on the OpenRouter key. Embeddings
still use Cloudflare Workers AI (`CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`), including for local Docker deployments; set
`EMBEDDING_PROVIDER=mock` only for tests or a throwaway evaluation.

`LLM_DAILY_BUDGET_USD=0` means no Automatic paid overage is permitted. Provider
quota exhaustion fails closed: ingestion pauses and the feed stays available.

## Adding central sources

Central sources are public rows in `sources` that every user can see. Add one
from the terminal:

```bash
docker compose run --rm worker pnpm source:add https://hnrss.org/frontpage --title "Hacker News"
docker compose run --rm worker pnpm source:list
```

For a bulk catalog, point the importer at a directory of OPML files or a single
OPML URL. All imports are public and inactive by default; activate only the
categories you want the worker to fetch:

```bash
docker compose run --rm worker pnpm source:import /data/awesome-rss-feeds --dry-run
docker compose run --rm worker pnpm source:import /data/awesome-rss-feeds \
  --activate-category Tech --activate-category Programming \
  --activate-category Science --activate-category Italy
docker compose run --rm worker pnpm source:list --active
```

### Processing article backlogs

If articles are stuck in `pending` or `processing` state (e.g. after a large import or a worker crash), you can enqueue them for processing:

```bash
# Dry-run: show what would be enqueued
docker compose run --rm worker pnpm worker:process-articles -- --dry-run --limit 20 --status processing,pending

# Real run: enqueue up to 20 processing+pending articles and drain the queues
docker compose run --rm worker pnpm worker:process-articles -- --limit 20 --status processing,pending
```

Options:
- `--limit N` — max articles to enqueue (default 20)
- `--status processing,pending` — which statuses to include (default both)
- `--dry-run` — only log what would be enqueued

`source:add` discovers RSS/Atom/JSON feeds, stores the canonical URL, and marks
the source due for the next worker run. `API` and `READ_IT_LATER` are valid
stored source types but are not ingested by the worker.

After three consecutive feed fetch/parse failures the worker deactivates the
source (it does not delete it). Retries within the same 10-minute window count
once, and any successful fetch resets the counter. Use `source:list --failed`
to inspect the failure counter; CLI reactivation via `source:add` or
`source:import --activate-category` clears the failure state.

## Reverse proxy and TLS

Put a TLS-terminating reverse proxy in front of the app. Preserve the original
host and scheme:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Set `NEXT_PUBLIC_APP_URL=https://scroll.example.com`, rebuild, and restart. HSTS
is emitted only when the request arrives over HTTPS (directly or through
`X-Forwarded-Proto`).

For QStash or Inngest, expose the worker webhook port as well. The worker
listens on `QUEUE_WEBHOOK_PORT` (default `3101`) at `/jobs`. Compose publishes
that port; place it behind the same TLS proxy and keep
`QUEUE_WEBHOOK_SECRET` private.

## Migrations

Migrations are SQL files in `packages/db/migrations`. The migrate service runs
them inside a transaction and records applied filenames in `schema_migrations`.

```bash
docker compose run --rm migrate
```

Run migrations before deploying new app or worker images. They are idempotent.

## Backups and restore

Create a compressed logical backup:

```bash
docker compose exec -T db pg_dump -U openscroll -Fc openscroll > openscroll-$(date +%F).dump
```

Restore into a fresh database:

```bash
# Stop writers first.
docker compose stop app worker

# Recreate an empty database.
docker compose exec -T db psql -U openscroll -d postgres \
  -c 'DROP DATABASE IF EXISTS openscroll;' \
  -c 'CREATE DATABASE openscroll OWNER openscroll;'

# Restore, then run migrations to confirm the schema is current.
docker compose exec -T db pg_restore -U openscroll -d openscroll --clean --if-exists < openscroll-YYYY-MM-DD.dump
docker compose run --rm migrate

docker compose start app worker
```

Test restore procedures on a copy before relying on them. Store backups off the
Docker host, encrypt them, and define a retention period. A backup is only
useful if a restore has been rehearsed.

## Upgrades

```bash
docker compose exec -T db pg_dump -U openscroll -Fc openscroll > pre-upgrade.dump
git pull
docker compose build
docker compose run --rm migrate
docker compose up -d
```

The web and worker images must run the same migration version. Do not run
multiple migration jobs concurrently.

## Queue drivers

### pg-boss (default)

No extra service. Jobs live in PostgreSQL and use the direct connection URL.
This is the recommended personal and small-team deployment.

### BullMQ

BullMQ requires Redis. Start the optional service and configure both app and
worker:

```bash
docker compose --profile bullmq up -d redis
```

```env
QUEUE_DRIVER=bullmq
REDIS_URL=redis://redis:6379
BULLMQ_PREFIX=openscroll
```

Redeploy the app and worker. BullMQ failed jobs are copied to the `dead-letter`
queue. Redis becomes state that must be backed up if job durability matters.

### QStash

QStash calls the worker webhook directly:

```env
QUEUE_DRIVER=qstash
QSTASH_TOKEN=...
QUEUE_WEBHOOK_URL=https://worker.example.com/jobs
QUEUE_WEBHOOK_SECRET=<32+ random characters>
QUEUE_WEBHOOK_PORT=3101
```

The adapter forwards the shared secret to the worker, sets retries, delay, and
singleton deduplication. The worker must be publicly reachable over HTTPS.
Adapter-managed schedules use QStash Schedules; the in-memory schedule ID map is
not durable across worker restarts, so prefer the worker's own scheduler for
critical recurring work.

### Inngest

Inngest receives events and must forward each event to the worker webhook:

```env
QUEUE_DRIVER=inngest
INNGEST_EVENT_KEY=...
INNGEST_EVENT_NAME=openscroll/job
QUEUE_WEBHOOK_URL=https://worker.example.com/jobs
QUEUE_WEBHOOK_SECRET=<32+ random characters>
QUEUE_WEBHOOK_PORT=3101
```

The Inngest function must POST `event.data.job` to `event.data.webhook_url` with
the `x-openscroll-queue-secret` header, retry on non-2xx, and keep the secret in
Inngest's server-side environment rather than in event data. Inngest cron is
configured on the Inngest function, not by the queue adapter.

## Operations checklist

- Keep the worker stateless; state belongs in PostgreSQL (or Redis for BullMQ).
- Monitor `/api/v1/health`, queue depth, failed jobs, and provider usage.
- Use `/admin` takedown to hide cards and clear stored article content.
- Rotate `AUTH_SECRET` by invalidating sessions, and rotate `ADMIN_TOKEN`
  deliberately.
- Keep `NEXT_PUBLIC_SOURCE_URL` pointed at the source for your deployed version,
  as required by AGPL-3.0 section 13.
- Review [`SECURITY.md`](./SECURITY.md), [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md),
  and [`SCALING.md`](./SCALING.md) before exposing the instance publicly.

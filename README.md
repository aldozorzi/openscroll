# OpenScroll

OpenScroll is an open-source, self-hostable micro-learning platform focused on software development, programming, IT, AI, hardware, and technology: RSS/web ingestion, LLM-generated micro-cards, vector recommendations, and spaced repetition with exact-day intervals.

The implementation plan and decisions live in [`PROGRESS.md`](./PROGRESS.md). The full technical requirements are in the parent [`SPECS.md`](../SPECS.md).

## Current status

All implementation blocks are complete. The deployment, hardening, and scale paths are documented below.

Implemented:

- pnpm workspace for `apps/*` and `packages/*`
- Shared Zod contracts for cards, feed, interactions, reviews, preferences, sources, and API errors
- Typed environment validation
- Drizzle schema, initial PostgreSQL + `pgvector` migration, migration runner, and seed script
- Local PostgreSQL with `pgvector` via Docker Compose
- `pg-boss` queue adapter with retries, dead-letter routing, singleton deduplication, scheduling, and stats
- SSRF-safe fetch with DNS pinning, redirect re-validation, timeouts, and response-size caps
- URL canonicalization, RSS/Atom/JSON feed parsing, conditional GET, feed discovery, Readability extraction, and HTML sanitization
- LLM and embedding provider adapters: Gemini, OpenRouter (OpenAI-compatible), Cloudflare Workers AI, and mocks
- Prompt-injection-hardened card generation, an LLM technology-relevance classifier, schema validation, normalized 1024-dim embeddings, usage tracking, and fail-closed quotas
- Worker CLI with source scheduling, RSS ingestion, article extraction, card generation, retention cleanup, retries, dead-letter routing, graceful shutdown, and **article backlog processing**
- Scheduled GitHub Actions worker with overlap prevention
- Bounded recommendation ranking with configurable weights, filters, diversity caps, optional MMR, cold start, and score/id cursor pagination
- 60-second feed cache with per-user and global invalidation helpers
- Normalized user-vector updates plus the `recompute-user-vector` worker handler
- **Exact-day review intervals** (1 / 3 / 7 / 14 days) with FSRS-backed memory state
- Next.js 16 API with Argon2id authentication, opaque revocable sessions, refresh rotation, CSRF, and rate limiting
- Feed, card detail, interactions, spaced-repetition reviews, saved cards, source discovery, OPML import, preferences, health, admin, GDPR, and OpenAPI endpoints
- API integration tests covering auth, CSRF, feed, interactions, reviews, saved cards, exports, OPML, admin routes, and account deletion
- Responsive Next.js 16 app shell with auth, three-step onboarding, swipe/keyboard feed, card detail, **Like/Dislike/Save/Source/Prev/Next**, exact-day review bar, saved library, source management/OPML, and settings
- EN/IT localization, system/light/dark themes, reduced-motion support, accessible controls, offline interaction queue, PWA manifest, and AGPL source link
- Playwright E2E coverage for onboarding, seeded feed navigation, save/saved, and due-card review on mobile and desktop
- CSP nonce and security headers, ORIGIN/CSRF enforcement, structured request/provider/job logs, and admin queue/usage/takedown views
- Queue factory with `pg-boss`, BullMQ, QStash, and Inngest adapters selected by environment
- Multi-stage Dockerfiles and self-host Compose with migration, healthchecks, volumes, and optional Redis
- Backup/restore, deployment, scaling, security, and content-policy documentation
- AGPL-3.0 license text, third-party notices, and CI with unit, integration, build, and audit checks

## Requirements

- Node.js >= 22.12
- pnpm (the repository pins `pnpm@12.15.0`; `corepack pnpm` works)
- Docker (for local PostgreSQL + pgvector)

## Quick start

```bash
cd openscroll
corepack pnpm install
cp .env.example .env

docker compose up -d db
corepack pnpm db:migrate
corepack pnpm db:seed

corepack pnpm typecheck
corepack pnpm test

# API and UI at http://localhost:3000 (routes under /api/v1)
corepack pnpm dev
```

## Frontend and E2E

```bash
# Install the Playwright Chromium browser once
corepack pnpm --filter @openscroll/web test:e2e:install

# Build, start on port 3100, seed deterministic sources/cards, run mobile + desktop
corepack pnpm test:e2e
```

Playwright uses `NEXT_STANDALONE=false` so `next start` can serve the test build. E2E specs live in `apps/web/e2e/` and are excluded from Vitest. `pnpm test:e2e` creates an isolated temporary PostgreSQL database from the migrated test template, truncates and seeds it, then drops it, so the main database is never modified.

## API

All endpoints are versioned under `/api/v1`. Authentication uses the HTTP-only `openscroll_session` cookie; state-changing requests also require the `openscroll_csrf` cookie echoed in the `x-csrf-token` header. The interactive contract is available at `/api/v1/openapi.json` (also `/api/v1/openapi`).

Core routes:

- `POST /api/v1/auth/register`, `/auth/verify-email`, `/auth/resend-verification`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`
- `GET /api/v1/me`; `PUT /api/v1/user/preferences`; `GET /api/v1/me/saved`; `GET /api/v1/me/export`; `DELETE /api/v1/me`
- `GET /api/v1/feed`; `GET /api/v1/cards/:id`; `POST /api/v1/cards/:id/interaction`; `POST /api/v1/cards/:id/review`
- `GET|POST /api/v1/sources`; `GET|DELETE /api/v1/sources/:id`; source status/subscribe routes; `POST /api/v1/sources/import/opml`
- `GET /api/v1/health`; admin ingest/usage/queue/reembed/takedown routes protected by `ADMIN_TOKEN`

`INTERACTION` and `REVIEW` writes require an `Idempotency-Key` header. Source discovery and OPML imports return `202 Accepted` and enqueue ingestion through the configured queue driver.

### Registration and email verification

`POST /api/v1/auth/register` never signs the user in. It always returns `202 { "ok": true }` with no session, so the endpoint cannot be used to discover whether an address already exists. A verification link is emailed to new or still-unverified addresses; the account stays unusable until that link is consumed.

The CAPTCHA token is checked with Cloudflare Turnstile before any account lookup. Set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` to enable it (production registration returns `503` without them). In development the widget is shown and verified but failures are not blocking, so local flows keep working.

`POST /api/v1/auth/verify-email` consumes the one-time token (hashed at rest, valid for 24 hours) together with the password chosen at registration, activates the account, and signs the user in. Requiring the password means that clicking an unsolicited link cannot activate an attacker-chosen credential. `POST /api/v1/auth/resend-verification` requests a new link and is CAPTCHA-protected. Verification sends are limited to one every 60 seconds and three per address per day, plus a global `VERIFICATION_EMAIL_DAILY_LIMIT` (default 50). Set `RESEND_VERIFICATION_API_KEY` and `EMAIL_VERIFICATION_FROM` to isolate verification traffic from password reset; both fall back to `RESEND_API_KEY` / `EMAIL_FROM` when empty.

### Password reset

`POST /api/v1/auth/forgot-password` sends a one-time link through Resend when `RESEND_API_KEY` is set, but only for verified addresses. In development, a missing key logs the reset URL instead. Set `EMAIL_FROM` to a verified Resend sender; the default `OpenScroll <onboarding@resend.dev>` is only suitable for Resend test deliveries.

`POST /api/v1/auth/reset-password` consumes the token, updates the password, revokes every existing session, and signs the user in with a new session. Tokens are hashed at rest, expire after 30 minutes, and are single-use. The request endpoint always returns `202` so it does not reveal whether an email is registered.

### Review endpoint

`POST /api/v1/cards/:id/review` now accepts `{ "interval_days": 1 | 3 | 7 | 14 }` and returns `{ "interval_days": 7, "next_review": "...", ... }`. The FSRS memory model is still updated internally; the next review is scheduled exactly at the chosen interval.

## Queue drivers

`QUEUE_DRIVER` selects the backend without domain-code changes:

- `pg-boss` (default): PostgreSQL, no extra service.
- `bullmq`: requires `REDIS_URL` and optionally the Compose `bullmq` profile.
- `qstash`: publishes to Upstash and delivers to the worker webhook.
- `inngest`: publishes events; an Inngest function forwards events to the worker webhook.

See [`docs/SELF-HOSTING.md`](docs/SELF-HOSTING.md) and
[`docs/SCALING.md`](docs/SCALING.md) for configuration and cutover details.

## Self-hosting

```bash
cp .env.example .env
# Set AUTH_SECRET, CRON_SECRET, ADMIN_TOKEN, provider credentials, and the Resend keys.
docker compose up -d --build
curl -fsS http://localhost:3000/api/v1/health
```

Compose applies migrations before starting the app and worker. See
[`docs/SELF-HOSTING.md`](docs/SELF-HOSTING.md) for TLS, backups, queue drivers,
and upgrades. Personal Vercel/Neon deployment is covered in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Worker

The worker uses the direct database URL for application queries and for the
default `pg-boss` queue.

```bash
# Schedule due sources and retention work, drain all queues, then exit
corepack pnpm worker:run

# Stay alive and schedule due work every minute
corepack pnpm worker:watch

# Only enqueue due work (useful from an external scheduler)
corepack pnpm worker:schedule

# Enqueue one source by UUID
corepack pnpm --filter @openscroll/worker enqueue-source <source-uuid>

# Process pending/processing articles (e.g. backlog)
corepack pnpm worker:process-articles -- --limit 20 --status processing,pending

# Add or reactivate a central public feed source
corepack pnpm source:add https://hnrss.org/frontpage --title "Hacker News"

# Add a source with a shorter fetch interval and an explicit type
corepack pnpm source:add https://example.com/feed.xml --interval 30 --type atom

# Import a directory or URL of OPML files (all imported inactive by default)
corepack pnpm source:import /tmp/awesome-rss-feeds --dry-run
corepack pnpm source:import /tmp/awesome-rss-feeds \
  --activate-category Programming --activate-category Tech \
  --activate-category "Web Development" --activate-category "UI / UX"

# Keep only technology sources, purge non-tech content, and reset tech sources
corepack pnpm db:curate-tech --dry-run
corepack pnpm db:curate-tech --purge-content

# List configured or only active sources
corepack pnpm source:list
corepack pnpm source:list --active
corepack pnpm source:list --failed
```

`source:add` discovers RSS, Atom, and JSON feeds, stores the source as public,
and schedules it for the next worker run. `source:import` is for bulk OPML
catalogs: imports are public and inactive unless their category is passed with
`--activate-category`, so a large catalog does not start fetching everything at
once. Private sources are still added from the Sources page. The database also
accepts `API` and `READ_IT_LATER` source types, but the worker only ingests the
three feed types today.

`db:curate-tech` deactivates sources outside the technology categories and can
purge existing cards/articles and reschedule the remaining tech sources. Add
`--activate` to activate inactive sources whose categories are in the tech
allowlist. Before a card is generated, an LLM classifier rejects articles whose
primary subject is not software, IT, AI, hardware, or technology; obvious
off-topic titles are filtered earlier without an LLM call.

Feed fetch/parse failures increment `sources.consecutive_failures`. Retries of
the same incident within 10 minutes count once, and a successful fetch resets
the counter. At three consecutive failed ingest cycles the source is
automatically deactivated instead of deleted, so subscriptions and history are
kept. Inspect them with `source:list --failed`; `source:add` or a new
`source:import --activate-category` run resets the counter when reactivating.

For local runs without provider credentials, use the deterministic mocks:

```bash
LLM_PROVIDER=mock EMBEDDING_PROVIDER=mock corepack pnpm worker:run
```

GitHub Actions runs `pnpm worker:run` every 30 minutes with a `concurrency` group that prevents overlapping drains. Configure the database, provider credentials, and limits as repository secrets/variables.

Database integration tests are skipped by default. Run the API, FSRS review, worker pipeline, and user-vector tests against a migrated local database with:

```bash
RUN_WORKER_DB_TESTS=1 corepack pnpm test
```

## Recommendation and FSRS

`@openscroll/recommendation` exposes `rankFeed()` for the full ranking pipeline: published/embedding validation, dismissed and session-seen exclusion, language/topic filters, learn/review mode rules, weighted scoring, optional MMR, source/topic caps, cold start, and cursor pagination. The feed serves the shared public catalog plus the user's private or subscribed sources; cards from private sources are not exposed through feed, detail, interaction, review, or saved endpoints. `TtlFeedCache` provides the 60-second feed cache and per-user/global invalidation hooks. User-vector helpers implement the `+0.05` positive and `-0.03` negative update rules and keep vectors normalized.

`@openscroll/fsrs` wraps `ts-fsrs` 5.4.2. `transitionReview()` is the pure scheduling function, `submitReview()` persists the current state and append-only review log transactionally with idempotency keys, and `dueUrgency()` supplies the bounded overdue score. Review intervals are now **explicit days** (1 / 3 / 7 / 14) chosen by the user; FSRS updates the internal memory state while `next_review` is set to exactly the chosen interval.

## Workspace layout

```text
apps/
  web/                 Next.js app, UI, and API
  worker/              queue worker CLI and pipeline handlers
packages/
  contracts/           shared Zod schemas and TypeScript types
  config/              runtime environment validation
  db/                  Drizzle schema, migrations, client, seed
  queue/               QueueAdapter implementations and driver factory
  ingest/              RSS, discovery, SSRF guard, extraction
  ai/                  LLM/embedding adapters, prompts, quotas
  recommendation/      ranking, diversity, cursors, cache, user vectors
  fsrs/                ts-fsrs adapter, due urgency, review service
```

## Database

The initial migration creates:

- users, preferences, sessions
- sources, per-user subscriptions
- articles and cards
- interactions, FSRS state, append-only review log
- provider usage and audit log
- HNSW index for 1024-dimensional `bge-m3` embeddings

Use the direct database URL for migrations and all `pg-boss` operations. Use the pooled Neon URL only for ordinary request-path queries.

## Notes

Dependencies are currently installed at the workspace root with `node-linker=hoisted` to keep the initial scaffold small. Package-level dependency declarations can be tightened once the packages stabilize.

The project is licensed under AGPL-3.0. The full text is in [`LICENSE`](LICENSE) and third-party notices are in [`NOTICE`](NOTICE). Operators must set `NEXT_PUBLIC_SOURCE_URL` to the corresponding source for their deployed version.

Security and operations:

- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/BACKUP_RESTORE.md`](docs/BACKUP_RESTORE.md)
- [`docs/CONTENT_POLICY.md`](docs/CONTENT_POLICY.md)
- [`docs/SCALING.md`](docs/SCALING.md)
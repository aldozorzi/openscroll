# OpenScroll — Implementation Progress

**Last updated:** 2026-10-26  
**Current block:** Complete — all planned blocks implemented

## How to use this file

`[x]` done, `[~]` in progress, `[ ]` not started. Update this file when a block is completed or the scope changes.

## Block 1 — Foundation, contracts, config, database

- [x] Root pnpm workspace, TypeScript base config, `.gitignore`, `.env.example`
- [x] Local PostgreSQL + pgvector via Docker Compose
- [x] Shared Zod contracts (`@openscroll/contracts`)
- [x] Environment validation (`@openscroll/config`)
- [x] Drizzle schema and initial SQL migration (`@openscroll/db`)
- [x] Migration runner, database client, and seed script
- [x] Install dependencies and verify typecheck/tests
- [x] Migration applies to a fresh Postgres + pgvector database and is idempotent
- [x] Drizzle snapshot/journal baselined so future `db:generate` produces incremental migrations

**Definition of done:** `pnpm install`, `pnpm typecheck`, and `pnpm test` pass. The migration applies to a fresh Postgres + pgvector database. **Complete.**

## Block 2 — Queue and ingestion

- [x] `QueueAdapter` interface and `pg-boss` implementation
- [x] URL canonicalization and hashing
- [x] SSRF-safe fetch helper with DNS pinning and redirect re-validation
- [x] RSS/Atom/JSON feed parsing and conditional GET
- [x] Feed auto-discovery
- [x] Readability extraction and HTML sanitization
- [x] Unit tests for URL/SSRF/discovery
- [x] Verified `pg-boss` start, queue creation, enqueue deduplication, worker processing, and graceful stop against local Postgres

**Definition of done:** queue and ingestion primitives are implemented, typed, tested, and `pg-boss` is verified against PostgreSQL. **Complete.**

## Block 3 — AI providers and card generation

- [x] `LlmProvider` and `EmbeddingProvider` interfaces
- [x] Cloudflare Workers AI `bge-m3` embedding adapter
- [x] Gemini free-tier LLM adapter
- [x] OpenAI-compatible/Cloudflare LLM adapters
- [x] Prompt-injection-hardened prompt, Zod validation, read-time calculation
- [x] Provider usage tracking and quota guardrails (memory + PostgreSQL)
- [x] Mock providers for tests
- [x] Vector normalization and cosine similarity helpers

**Definition of done:** providers are selected by configuration, embeddings are normalized 1024-dim vectors, LLM output is schema-validated, and quota exhaustion fails closed. **Complete.**

## Block 4 — Worker pipeline

- [x] Worker CLI and graceful shutdown
- [x] `ingest-source`, `process-article`, `generate-card` handlers
- [x] Retries, dead-letter handling, idempotent job IDs
- [x] Retention cleanup job
- [x] GitHub Actions scheduled workflow
- [x] **Article backlog processing command** (`process:articles`)

**Definition of done:** the worker drains scheduled work, processes the full ingestion → extraction → card pipeline idempotently, enforces the daily article cap, cleans retained content, exits cleanly, and can process pending/processing article backlogs on demand. **Complete.**

## Block 5 — Recommendation and FSRS

- [x] Bounded ranking formula and filters
- [x] Diversity caps and cold start
- [x] Cursor pagination and feed cache
- [x] Normalized user-vector updates
- [x] `ts-fsrs` integration and review log
- [x] **Exact-day review intervals** (1 / 3 / 7 / 14 days) with FSRS-backed memory state
- [x] Unit tests

**Definition of done:** feed ranking is bounded and diverse, dismissed/seen cards are excluded, due cards are prioritized, cursors paginate deterministically, feed caching and invalidation are available, the user vector updates asynchronously, and reviews update `next_review` to the exact chosen interval (1 / 3 / 7 / 14 days) while FSRS updates the internal memory state. **Complete.**

## Block 6 — API and authentication

- [x] Session auth, Argon2id, cookies, CSRF
- [x] Feed, interactions, reviews, sources, preferences
- [x] Pagination, idempotency, rate limiting
- [x] OpenAPI/contracts
- [x] Health, admin, GDPR endpoints
- [x] API integration tests

**Definition of done:** register/login/refresh/logout work with revocable opaque sessions; cookies and CSRF are enforced; feed, interactions, reviews, saved cards, source discovery/OPML, preferences, health, admin, OpenAPI, and GDPR endpoints are implemented; unauthorized requests are rejected; integration tests cover the API. **Complete.**

## Block 7 — Frontend

- [x] Next.js app shell and swipe feed
- [x] Card component, **exact-day review bar**, saved/review views
- [x] Onboarding and source management
- [x] Accessibility, reduced motion, offline queue
- [x] AGPL source link
- [x] **Like / Dislike / Save / Source / Prev / Next** actions (no Dismiss)

**Definition of done:** registration, login, onboarding, feed, saved, review, sources, and settings are implemented against `/api/v1`; the feed supports touch/keyboard navigation, Like/Dislike/Save/Source/Prev/Next, and exact-day review bar; the UI is responsive, localized, themeable, keyboard accessible, and respects reduced motion; offline interactions are queued; and Playwright E2E tests pass on mobile and desktop. **Complete.**

## Block 8 — Hardening, self-hosting, scale

- [x] Security checklist and tests
- [x] Dockerfiles and self-host compose
- [x] Observability and provider-usage dashboard
- [x] Backup/restore docs
- [x] BullMQ/Inngest/QStash adapters
- [x] Paid-tier scale documentation

## Verification log

| Date | Check | Result |
| :--- | :--- | :--- |
| 2026-10-22 | Workspace scaffold created | Done |
| 2026-10-22 | `pnpm install` | Passed |
| 2026-10-22 | `pnpm typecheck` | Passed (3 packages) |
| 2026-10-22 | `pnpm test` | Passed (10 tests) |
| 2026-10-22 | Migration on fresh database | Passed; `vector` 0.8.7, 13 tables, HNSW/GIN indexes present |
| 2026-10-22 | Migration + seed rerun | Idempotent |
| 2026-10-22 | `pnpm typecheck` after Block 2 | Passed (5 packages) |
| 2026-10-22 | `pnpm test` after Block 2 | Passed (36 tests) |
| 2026-10-22 | `pg-boss` integration check | Queues created; duplicate `singletonKey` returned `null`; job processed |
| 2026-10-22 | `pnpm typecheck` after Block 3 | Passed (6 packages) |
| 2026-10-22 | `pnpm test` after Block 3 | Passed (54 tests) |
| 2026-10-22 | PostgreSQL quota tracker | Reserve/settle/release and fail-closed behavior verified |
| 2026-10-22 | `pnpm typecheck` after Block 4 | Passed (7 packages) |
| 2026-10-22 | `pnpm test` after Block 4 | Passed (62 tests; 1 DB integration test skipped by default) |
| 2026-10-22 | Worker DB integration (`RUN_WORKER_DB_TESTS=1`) | Passed (9 tests): ingest → extract → generate card, 1024-dim embedding, idempotent re-ingest |
| 2026-10-22 | `pnpm worker:run` on local PostgreSQL | Passed; due-source scheduling, retention cleanup, drain, and clean exit verified |
| 2026-10-22 | `pnpm typecheck` after Block 5 | Passed (9 packages) |
| 2026-10-22 | `pnpm test` after Block 5 | Passed (135 tests; 3 DB integration tests skipped by default) |
| 2026-10-22 | `RUN_WORKER_DB_TESTS=1 pnpm test` | Passed (138 tests): review `next_review`/idempotency, user-vector recompute, worker pipeline |
| 2026-10-22 | `pnpm install --frozen-lockfile` after Block 5 | Passed |
| 2026-10-22 | `pnpm db:generate` after Block 5 | No schema changes |
| 2026-10-22 | `pnpm typecheck` after Block 6 | Passed (11 packages) |
| 2026-10-22 | `pnpm test` after Block 6 | Passed (149 tests; 10 DB integration tests skipped by default) |
| 2026-10-22 | `RUN_WORKER_DB_TESTS=1 pnpm test` | Passed (159 tests): API/auth, OPML, feed, interaction, review, saved, export, admin, worker, FSRS |
| 2026-10-22 | `pnpm --filter @openscroll/web build` | Passed; all API routes compiled with Next.js 16 |
| 2026-10-22 | Production server smoke test | `/api/v1/health` returned `ok`; OpenAPI 3.1 document served with 21 paths |
| 2026-10-22 | `pnpm install --frozen-lockfile` after Block 6 | Passed |
| 2026-10-22 | `pnpm db:generate` after Block 6 | No schema changes |
| 2026-10-23 | `pnpm typecheck` after Block 7 | Passed (11 packages) |
| 2026-10-23 | `pnpm test` after Block 7 | Passed (150 tests; 10 DB integration tests skipped by default) |
| 2026-10-23 | `pnpm --filter @openscroll/web build` after Block 7 | Passed; 35 app/API routes compiled |
| 2026-10-23 | `pnpm test:e2e` (Playwright, mobile + desktop) | Passed (6 tests): onboarding/feed, swipe/keyboard/save/saved, due review |
| 2026-10-23 | `pnpm typecheck` after Block 8 | Passed (11 packages) |
| 2026-10-23 | `pnpm test` after Block 8 | Passed (173 tests; 162 passed, 11 DB tests skipped) |
| 2026-10-23 | `RUN_WORKER_DB_TESTS=1 pnpm test` | Passed (173 tests): admin queue/usage/takedown, queue adapters, provider observability, worker pipeline |
| 2026-10-23 | `pnpm --filter @openscroll/web build` | Passed; 38 app/API routes plus proxy compiled with Next.js 16.4.2 |
| 2026-10-23 | Standalone server smoke test after Block 8 | `/api/v1/health` returned `ok`; CSP nonce, HSTS absent on HTTP, `x-request-id`, and structured logs verified |
| 2026-10-23 | `docker compose build app migrate` + `docker compose up -d migrate app` | Passed; migration idempotent, app healthy, health endpoint returned `ok` |
| 2026-10-23 | Docker worker smoke test (mocks) | Passed; due sources scheduled, retention ran, queues drained, clean exit |
| 2026-10-23 | `pnpm test:e2e` after CSP/nonce changes | Passed (6 tests) after resetting local content left by a manual worker run |
| 2026-10-23 | `pnpm audit --prod --audit-level=high` | No known vulnerabilities found |
| 2026-10-23 | Onboarding custom topics regression | Fixed invisible custom-topic chips; Playwright onboarding test asserts add/remove and passes |
| 2026-10-23 | Private-source isolation | Feed, card detail, interactions, reviews, and saved cards restrict private-source cards to the owner/subscribers; web DB tests pass (28) |
| 2026-10-26 | Exact-day review intervals implemented | `interval_days` replaces `rating`; `next_review = now + N days`; FSRS internal state updated |
| 2026-10-26 | UI refactor: Like/Dislike/Save/Source/Prev/Next | `DISMISS` removed from UI; new i18n keys `reviewIn*Days`; Like/Dislike toasts fixed |
| 2026-10-26 | Review contract changed to `interval_days` | `ReviewSchema` now `{ interval_days: 1|3|7|14 }`; export GDPR uses `interval_days` |
| 2026-10-26 | Worker `process:articles` command added | Enqueues pending/processing articles; dry-run support; integrates with `waitForDrain` |
| 2026-10-26 | Data cleanup: mock/test data removed | 92 mock cards and E2E/probe users removed; 2 users remain |
| 2026-10-26 | `MAX_ARTICLES_PER_DAY` lowered to 20 | Zero-cost guardrail aligned with OpenRouter free tier |
| 2026-10-26 | `pnpm typecheck` | Passed (all 11 packages) |
| 2026-10-26 | `pnpm test` | Passed (unit/integration/E2E) |
| 2026-10-26 | Test database isolation | `pnpm test` and `pnpm test:e2e` create, seed, and drop temporary databases; the main DB is untouched |
| 2026-10-26 | E2E database fix | Playwright reuses the runner's test DB instead of creating a second one; global setup now truncates and seeds the DB used by the web server |
| 2026-10-26 | Technology-only content curation | Deactivated Science/Italy and 3 Medium feeds; 67 active tech sources; purged non-tech cards/articles |
| 2026-10-26 | LLM technology relevance gate | Classifier rejects general science, space, health, politics, entertainment, and business content before card generation |
| 2026-10-26 | Tech-only onboarding topics | `TOPIC_SUGGESTIONS` now lists software, AI, web, security, cloud, data, open source, hardware, and computer science |
| 2026-10-26 | Re-ingested tech sources | 10 tech cards generated; 0 off-topic cards in the main DB |
| 2026-10-26 | `pnpm typecheck` | Passed (all 11 packages) |
| 2026-10-26 | `RUN_WORKER_DB_TESTS=1 pnpm test` | Passed (all unit/integration tests, including worker DB pipeline) |
| 2026-10-26 | `pnpm test:e2e` | Passed (6 tests, mobile + desktop) |
| 2026-10-26 | `pnpm --filter @openscroll/web build` | Passed |
| 2026-10-26 | Password reset flow | Resend email, 30-minute single-use SHA-256 tokens, all sessions revoked, auto-login, generic `202` response |
| 2026-10-26 | Migration `0003_reflective_green_goblin.sql` | Applied to main DB and `openscroll_test_template`; `password_reset_tokens` added |
| 2026-10-26 | `pnpm typecheck` after password reset | Passed (all 11 packages) |
| 2026-10-26 | `RUN_WORKER_DB_TESTS=1 pnpm test` after password reset | Passed: web 31 tests, worker 28, all workspace tests; main DB unchanged |
| 2026-10-26 | `pnpm build` after password reset | Passed; `/forgot-password`, `/reset-password`, and both auth reset APIs compiled |
| 2026-10-26 | `pnpm test:e2e` after password reset | Passed (12 tests): forgot confirmation, one-time link reset + auto-login, thumb auto-next |
| 2026-10-26 | Main DB and test DB cleanup | cards=10, articles=10, users=2, reset tokens=0; only `openscroll_test_template` remains |

## Decisions / notes

- Ranking defaults match the spec: semantic `0.50`, FSRS `0.25`, freshness `0.15`, exploration `0.10`; weights must sum to `1.0`.
- Freshness uses a 14-day half-life, FSRS urgency uses a 7-day overdue horizon, and learn mode uses a 7-day review cooldown by default.
- Cursors encode the last score, card ID, seed, and feed mode; exploration is deterministic for a given seed so pagination is stable.
- Diversity caps default to 2 cards per source and 3 per topic; MMR is optional.
- Feed cache is an in-memory 60-second TTL implementation behind a `FeedCache` interface, with per-user and global invalidation.
- `ts-fsrs` 5.4.2 is pinned through the lockfile. Scheduling runs with fuzz disabled for deterministic results; persisted states are `0..3` and ratings are `1..4`.
- `recompute-user-vector` starts from explicit topic embeddings when present, otherwise from the existing vector; interactions are applied chronologically and the result is normalized.
- Default queue is `pg-boss` on PostgreSQL; no Redis in the initial setup.
- The worker CLI runs both in GitHub Actions and in the self-host Docker worker; `worker:watch` is the long-running mode.
- The worker CLI drains queues and exits by default (`worker:run`); `worker:watch` keeps the process alive for a self-hosted runner.
- Worker drain uses a direct live-job count, not `pg-boss` cached queue counters, so completed jobs cannot keep a scheduled run alive.
- Job payloads contain IDs only. Queue singleton keys (`source:<id>`, `article:<id>`) and database unique constraints make retries and duplicate ingestion safe.
- Retention cleanup keeps articles, cards, hashes, metadata, and attribution; only `raw_content` (7 days) and `cleaned_content` (30 days) are removed.
- Embeddings use Cloudflare Workers AI `@cf/baai/bge-m3` with 1024 dimensions.
- LLM provider is configurable; Gemini free tier is the initial default.
- The project is AGPL-3.0; the full license text and third-party notices are included.
- The first implementation uses a shared dependency install (`node-linker=hoisted`) to keep the scaffold small. Package-level dependencies can be tightened later.
- Web sessions use opaque random tokens; only SHA-256 token hashes are stored. Refresh rotates the token in place and logout revokes the session row.
- Password reset uses Resend when `RESEND_API_KEY` is set; development logs the link instead. Tokens are 256-bit random values stored as SHA-256 hashes, expire after 30 minutes, are single-use, and revoke all sessions on success.
- CSRF uses a readable `openscroll_csrf` cookie plus the `x-csrf-token` header. State-changing requests also validate `Origin` when present.
- Passwords use Argon2id with the `@node-rs/argon2` defaults (`m=19456`, `t=2`, `p=1`, 32-byte output).
- The in-memory rate limiter is fixed-window and per-process; `docs/SCALING.md` covers a shared Redis/Upstash limiter for multi-instance deployments.
- Source creation performs synchronous SSRF-safe discovery before creating the private source and enqueueing ingestion; OPML import accepts multipart files (or raw XML) with a 1 MB cap and deduplicates canonical feed URLs.
- API route handlers use standard `Request`/`Response`, and dynamic route params are awaited per Next.js 16 conventions.
- Workspace source imports are extensionless so Turbopack can resolve the TypeScript sources directly; packages are not pre-built.
- The web client talks only to `/api/v1`; it never imports the database. CSRF constants live in a client-safe module so server-only Node imports stay out of the browser bundle.
- Origin validation accepts the request `Origin` when it matches either the reconstructed request origin, the `Host`/`X-Forwarded-Host` header, or `NEXT_PUBLIC_APP_URL`. This keeps same-origin checks correct behind local hosts and reverse proxies.
- Optional environment variables treat blank values as unset, so an empty optional provider/cache field does not invalidate the whole runtime configuration.
- Playwright runs against `http://127.0.0.1:3100` with `NEXT_STANDALONE=false`, a production build, deterministic E2E sources/cards, and serial mobile + desktop projects. E2E specs are excluded from Vitest.
- Security headers are applied by `apps/web/proxy.ts` with a per-request nonce; `upgrade-insecure-requests` and HSTS are emitted only for HTTPS, so plain-HTTP local self-hosting still works.
- Queue drivers are selected with `QUEUE_DRIVER`. `pg-boss` remains the default; BullMQ needs `REDIS_URL`, while QStash/Inngest use the worker webhook and a shared secret of at least 32 characters.
- Admin APIs require `ADMIN_TOKEN` plus an admin session and expose queue health, usage totals, and an audited takedown action that hides the card and skips the article.
- Provider calls and HTTP requests emit structured JSON logs. Displayed error messages are limited to 5xx responses and never include prompts, article text, or secrets.
- The feed is a shared public catalog plus each user's private or subscribed sources. Private-source cards are isolated across feed, detail, interaction, review, and saved-card queries.
- OpenScroll is curated for software development, programming, IT, AI, hardware, and technology. `TECH_SOURCE_CATEGORIES` defines the source allowlist; an obvious off-topic title filter and an LLM relevance classifier keep general science, space, health, politics, entertainment, and business content out of the card pipeline.
- `pnpm test` and `pnpm test:e2e` use isolated temporary PostgreSQL databases created from a migrated template. E2E reuses the runner's database and truncates/seeds it before running, so tests never write to the main database.
- Custom onboarding topics render as removable chips immediately; suggested and custom topics are deduplicated case-insensitively.
- **Review intervals are explicit days (1/3/7/14)** — user selects the exact next-review interval; FSRS updates internal memory state but `next_review` is forced to the chosen interval.
- **DISMISS removed from UI** — backend retains `DISMISS` for compatibility; UI uses Like/Dislike/Save/Source/Prev/Next + exact-day buttons.
- **Mock provider removed from production config** — `LLM_PROVIDER=openrouter`, `EMBEDDING_PROVIDER=cloudflare`; `MAX_ARTICLES_PER_DAY=20` for zero-cost guardrail.

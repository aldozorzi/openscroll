# Scaling path

Move to a paid component only when a measured limit is reached. Changing queue
or hosting must not require domain-code changes: the queue factory and provider
adapters are configuration-selected.

## Triggers

| Trigger | First response | Paid move |
| :--- | :--- | :--- |
| GitHub Actions runs are too infrequent or too short | Move the worker to a container | Small worker VM |
| `pg-boss` polling adds database load | Tune concurrency and run fewer workers | Dedicated BullMQ + Redis |
| Neon storage or CU-hours exhausted | Prune, tune retention, add indexes | Larger Neon compute or another PostgreSQL |
| LLM quota blocks acceptable ingestion volume | Lower article caps, improve caching | Paid LLM plan or local model |
| Embedding quota exhausted | Batch embeddings, lower backfill rate | Paid embedding API or local model |
| Feed queries slow | Check indexes, cache hit rate, connection pool | Read replica or larger compute |
| Vercel Hobby no longer compliant | Move to standalone Docker | Paid host or VPS |

## Worker topology

The worker is stateless. Keep one long-lived worker container with a modest
concurrency, plus the scheduler:

```bash
docker compose up -d worker
```

Increase BullMQ worker concurrency or the number of worker containers only when
database, provider, and queue depth metrics show headroom. Stop the GitHub
Actions drain job when a long-lived worker owns the queue to avoid duplicate
scheduling.

## Queue migration

### PostgreSQL to BullMQ

1. Provision Redis with persistence and authentication.
2. Set `REDIS_URL`, `QUEUE_DRIVER=bullmq`, and `BULLMQ_PREFIX`.
3. Stop the old worker after it drains.
4. Start the worker with the BullMQ driver.
5. Keep `pg-boss` tables until the migration is verified; do not delete them
   during the cutover.
6. Back up Redis once it becomes authoritative.

Jobs already in `pg-boss` must be drained or re-enqueued before switching; the
adapter does not migrate live jobs between backends.

### Managed queues

QStash and Inngest are optional adapters for teams that prefer managed delivery.
They trade infrastructure work for vendor dependency and egress. The worker
webhook still applies the same handlers and permanent-error semantics.

For QStash, set `QUEUE_WEBHOOK_URL` to the public worker `/jobs` endpoint and
keep `QUEUE_WEBHOOK_SECRET` in both environments. For Inngest, implement the
forwarding function described in [`SELF-HOSTING.md`](./SELF-HOSTING.md).

## Database and providers

- Add a read replica only for read-heavy feed traffic; source ingestion and
  reviews must write to the primary.
- Keep the direct URL for queue and migration work.
- Move embeddings to a local or paid model by changing `EMBEDDING_PROVIDER`
  and the model configuration; regenerate vectors with the admin re-embed job.
- Move LLMs by changing `LLM_PROVIDER` and `LLM_MODEL`; prompt and output
  validation stay provider-independent.
- Add media/object storage only when the product supports media cards.

## Capacity guardrails

- Keep daily provider caps and `LLM_DAILY_BUDGET_USD=0` until you explicitly
  choose paid overage.
- Watch `provider_usage`, queue depth, failed/dead-letter counts, and database
  storage.
- Set alerts at 70% and 90% of each quota.
- Document every override of the zero-cost guardrails in the deployment runbook.

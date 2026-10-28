# Backup and restore

Back up PostgreSQL, the `.env` secrets (in a secret manager, not with the dump),
and Redis only if `QUEUE_DRIVER=bullmq`.

## Policy

- Full logical backup daily.
- Keep at least 7 daily and 4 weekly copies.
- Encrypt backups at rest and in transit.
- Store them outside the Docker host.
- Rehearse a restore monthly.
- Record the migration version or git commit next to each backup.

## PostgreSQL

### Backup

```bash
docker compose exec -T db pg_dump -U openscroll -Fc openscroll \
  > openscroll-$(date -u +%Y%m%dT%H%M%SZ).dump
```

For a managed database, use the provider's snapshot/PITR feature as well as
logical dumps. For Neon, enable and verify the project's restore window.

### Restore

```bash
docker compose stop app worker

docker compose exec -T db psql -U openscroll -d postgres \
  -c 'DROP DATABASE IF EXISTS openscroll;' \
  -c 'CREATE DATABASE openscroll OWNER openscroll;'

docker compose exec -T db pg_restore -U openscroll -d openscroll \
  --clean --if-exists < openscroll-YYYYMMDDTHHMMSSZ.dump

docker compose run --rm migrate
docker compose start app worker
curl -fsS http://localhost:3000/api/v1/health
```

After restore, check row counts, run a feed request, and process one queued job.
If the dump came from an older schema, run the current migrations before
starting the app.

## Redis / BullMQ

Redis holds queue state. Losing it may lose pending or retrying jobs.

```bash
docker compose exec -T redis redis-cli SAVE
docker compose cp redis:/data/dump.rdb ./redis-dump.rdb
```

Restore by placing `dump.rdb` in the Redis volume while Redis is stopped, then
start Redis. AOF mode is enabled in Compose, so `/data/appendonlydir` should also
be preserved when copying the volume manually.

## Secrets

Back up the values of `AUTH_SECRET`, `CRON_SECRET`, `ADMIN_TOKEN`,
`QUEUE_WEBHOOK_SECRET`, provider API keys, and `NEXT_PUBLIC_APP_URL` in a secret
manager. Database dumps alone cannot restore a working instance.

## Verification

At minimum, verify:

```bash
docker compose run --rm migrate
curl -fsS http://localhost:3000/api/v1/health
```

Then sign in, load the feed, and run an admin queue refresh. A backup is not
considered valid until a restore has been exercised.

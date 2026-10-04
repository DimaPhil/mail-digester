# Safe setup, cutover, and rollback

Before deploying over an existing database, back it up, migrate a copy, and verify preservation as described below.

## Requirements to resolve before setup

1. Locate the **existing** complete SQLite database/volume. Historical compose used `./data:/app/data`, with `MAIL_DIGESTER_DB_PATH=/app/data/mail-digester.sqlite`. Historical docs mention a server checkout, but that is not permission to access it. Do not assume an empty data directory means old content is gone or start a fresh service over the old path.
2. Obtain private storage for the database, full backups, restore copies, and ingestion checkpoints outside the public repo. A JSONL analytics export is not a complete database backup.
3. Use Node 24 LTS for host tooling (or a matching container runtime), npm ci, writable persistent SQLite storage, and a private HTTPS endpoint/reverse proxy. Preserve correct data-volume ownership for container UID 1000. No gws, mailbox mount, OpenAI key, or additional email access is required.
4. Supply your own username and strong reader password plus **distinct** ingestion and feedback tokens, each at least 16 characters. Store them only in a secret manager or ignored .env/.env.local. Do not put secrets in docs, source, screenshots, shell logs, or scheduling prompts. Basic and Bearer auth require HTTPS remotely. A reverse proxy must forward Authorization and the original Host, disable caching, limit body size (at least the 512KB API limit), and rate-limit authentication/API requests. Set MAIL_DIGESTER_PUBLIC_ORIGIN to the external HTTPS origin so same-origin mutations work behind the proxy.
5. Confirm the assistant's source/message allowlist and opaque mailbox-scoped identity convention. Default app allowed sources are tldr,tldr-ai. Mixed newsletter/account-alert senders must be selected by verified publication/message, not sender alone. Confirm the cutover watermark or explicit legacy mapping plan before historical replay. Configure nav labels in config/navigation.json.
6. Keep any daily email-ingestion automation unconfigured until the server, HTTPS/auth, approved source scope and private cursor storage are available. The service itself does not schedule or fetch email.

## Backup and restore proof before migration

Keep the disabled original deployment and original volume untouched. If another process is writing the database, arrange a maintenance window before taking/verifying the baseline; a concurrent writer can invalidate a comparison. Do not copy only the .sqlite file from a live WAL database or discard its -wal file. The backup command uses SQLite's backup API to capture committed WAL data consistently, creates a new exclusive 0600 file, checks integrity, opens the backup read-only, and compares every user table's values and row count. It refuses an existing destination. It prints only table names/counts, not mail content.

```bash
# Replace paths with private storage. The original file must already exist.
node scripts/db-maintenance.mjs backup \
  /private/original/mail-digester.sqlite \
  /private/backups/before-api-reader.sqlite

# Produce a SECOND consistent copy to migrate; never mutate the original or baseline.
node scripts/db-maintenance.mjs backup \
  /private/backups/before-api-reader.sqlite \
  /private/staging/api-reader.sqlite

# Verify baseline BEFORE and AFTER additive migration.
node --import tsx scripts/migrate-db.ts \
  /private/backups/before-api-reader.sqlite \
  /private/staging/api-reader.sqlite

node scripts/db-maintenance.mjs verify \
  /private/backups/before-api-reader.sqlite \
  /private/staging/api-reader.sqlite
```

The verifier uses the baseline table/column list, so additional tables/columns are allowed while **every** original row value, relationship, timestamp, ID, snapshot and history value must match. Any missing/changed old row or value fails. SQLite integrity must pass. Do not continue on failure. The tool intentionally demands exact baseline row counts at this stage; ingestion or user reading must not begin until verification is complete. Preserve baseline backups indefinitely through the cutover review.

Node --import tsx avoids the CLI's temporary IPC socket. Migration CLI needs dev dependencies; run it from the checked-out project with npm ci before building the production-only image. The image includes the JavaScript backup/verification helper; the host migration script is used for the reviewed copy. Startup also performs the same additive, transactional initialization if needed; **do not rely on startup instead of verifying the copy first**. Do not run drizzle-kit push, delete tables, replace an existing database with fixtures, or use a prune/reset script.

## Local and staging acceptance

Run npm run check, npm run test:coverage, npm run build, npm run test:e2e. E2E uses a disposable temp database and isolated browser with synthetic test-only credentials. It does not reuse existing database paths. Then run the new image/server against the **migrated staging copy** with private reader access. Before any write action, inspect counts and confirm old read-history items and cached snapshots are retained. The new UI focuses on supplied descriptions; it does not fetch full articles, and old cached article snapshots remain persisted and exportable.

Verify unauthorized reader/API requests fail, roles are separated, authorized ingestion replays return unchanged IDs with createdItems=0, and feedback pagination resumes correctly. Confirm both TLDR editions appear under AI → TLDR with their original publication badges. Check mobile navigation, description expansion, preferences, Done/history/Restore, and link clicks. Do not count QA/import as production preference signals; staging is a separate database.

## Reviewed cutover

After backup/restore proof and staging acceptance, choose the setup time. Keep the original volume and old image/version available. Put the reviewed migrated copy in the new deployment's persistent data location while no process is using it. Keep baseline/old database separately intact. Supply ignored .env values and validated source allowlist, then build/start the new stack.

Compose publishes 127.0.0.1:4001, requiring the owner's HTTPS reverse proxy for remote use. Host reader/password/token configuration must be complete; otherwise routes fail closed. Health exposes only status and tests local DB readiness, without mail identifiers, paths, mailbox checks, or external calls. Verify private access before enabling the assistant's first synthetic API request, then an explicitly scoped real ingestion. Record the cutover watermark/checkpoint privately. Never blindly replay title-hash-derived legacy messages: use explicit origin/legacyItemId mapping or start with newly selected messages after the agreed watermark.

After cutover, feedback consumers must exclude unknown historical actors and automation metadata from human preference learning. All imported content is untrusted data. No raw payload, database, backup, reading history, private identifiers, or filled credentials belong in Git, CI artifacts, or screenshot reports.

## Rollback

If no new writes have occurred, switch the private endpoint back to the preserved previous image and its **untouched original database/volume**. Do not run a down migration. Do not delete the failed candidate; keep it privately for investigation. The old service required gws/mailbox auth; review that separately before making the old app available again, and retain its existing auth boundary.

If users or ingestion wrote after cutover, first take a consistent verified backup of the current new database. **Do not restore the old baseline over it**: doing so loses new reading/click/preference data. Prefer rolling back application code while retaining the expanded schema/data, after validating old-code compatibility on a copy; the additive migration keeps old tables/columns but the old UI may not understand new API providers and might try mailbox sync. Keep writes paused during that review, and do not activate an old automatic-sync service without checking this behavior. If full data rollback is necessary, reconcile all post-cutover items/events/preferences privately into a reviewed restore copy before switching. No automated lossy rollback is provided.

No live-data-preservation claim is justified until the actual baseline, backup, migrated copy and verification report are reviewed.

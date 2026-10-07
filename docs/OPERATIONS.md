# Deployment and database migration

Use the [README setup](../README.md#local-setup) for credentials and runtime requirements, and the [API contract](API.md) for source configuration and replay identity.

## Deployment

- Use Node 24, persistent SQLite storage writable by container UID 1000, and Tailscale Serve HTTPS for remote access. The reader has no app login; restrict reachability to trusted tailnet users/devices.
- Compose binds `127.0.0.1:4001` and mounts `./data:/app/data`. Locate the existing database before starting over an old deployment; an empty directory is not proof that no prior data exists.
- Set `MAIL_DIGESTER_PUBLIC_ORIGIN` to the Tailscale HTTPS origin. Forward Authorization and Host through the proxy, disable private-response caching, and use a body limit that allows the API's 512,000 bytes.
- Store databases, backups, payloads, and ingestion checkpoints privately, outside the source checkout. The service does not retrieve mail or schedule ingestion.

Existing `MAIL_DIGESTER_INGEST_TOKEN` and `MAIL_DIGESTER_FEEDBACK_TOKEN` values are imported once into the database with their original individual permissions. They must be distinct and at least 16 characters when set. Empty values are allowed on fresh installations: create keys in Admin settings. After import, deleting/changing environment variables does not revoke or replace keys; manage them in Admin settings. Revocation survives restarts even while an old environment value remains configured. Backups now include key hashes and revocation history; protect them as credential data. Restore can undo later revocations, so reconcile key status before reconnecting API clients after rollback.

Contract changes require the server and installed CLI to update together. CLI preflight checks reject mismatched revisions before writes. Re-run the private GitHub global installation command from the README after deploying a new API contract.

## Preserve an existing database

Pause writes while taking the baseline and comparing copies. SQLite's backup API captures committed WAL data; copying only a live `.sqlite` file can lose it. Keep the original volume and previous image intact.

Run these commands from a checkout with `npm ci`, using separate private paths:

```bash
node scripts/db-maintenance.mjs backup \
  /private/original/mail-digester.sqlite \
  /private/backups/before-api-reader.sqlite

node scripts/db-maintenance.mjs backup \
  /private/backups/before-api-reader.sqlite \
  /private/staging/api-reader.sqlite

node --import tsx scripts/migrate-db.ts \
  /private/backups/before-api-reader.sqlite \
  /private/staging/api-reader.sqlite
```

Backup refuses an existing destination, creates a 0600 file, checks integrity, and compares all user-table values. Migration verifies the copy before and after adding schema. Every original value and row count must match; extra tables/columns are allowed. Stop on any failure. Do not ingest or read against the candidate until comparison is complete. A JSONL export is not a full backup; do not use `drizzle-kit push` to migrate existing data.

## Acceptance and cutover

Run `npm run verify:full`, then start the candidate against the migrated staging copy. Check private access, API role separation, ingest replay, feedback pagination, legacy history, both TLDR editions, topic navigation, preferences, and Done/Restore. Staging uses a separate database so QA does not become production preference evidence. Cached legacy articles remain stored and exportable.

With writes stopped, place the verified copy in the persistent deployment location and start the new image. Keep the original database and baseline backup. Before real ingestion, record a private cutover watermark or use the API's explicit legacy mapping to avoid duplicating old mail.

## Rollback

Before any post-cutover writes, the previous image and untouched original volume provide the baseline rollback. Review the old app's mailbox credentials, automatic sync behavior, and access boundary before starting it.

After new writes, back up the current database first. Restoring the old baseline directly would lose new items, reading history, and preferences. Validate old-code compatibility against a copy of the expanded database, or reconcile post-cutover data into a restore copy before switching. Keep writes paused during that review; do not run a down migration.

# Mail Digester

A private, single-reader library fed by structured email/link data. The assistant selects sources, extracts descriptions, and categorizes items; this service persists and renders those items and records explicit reader engagement. It contains no Gmail access, mailbox polling, OpenAI calls, or scheduled ingestion.

The reader has configurable category tabs and subtabs. AI → TLDR combines TLDR and TLDR AI while keeping each publication and appearance identifiable. Narrative newsletters can be shown without a link. Descriptions are plain text. There is no special AI feature list, automatic article fetch, remote image loading, or tracking pixel.

## Local setup

Use Node 24 LTS and `npm ci`. Copy `.env.example` to `.env.local` and supply **distinct** ingestion/feedback tokens (each secret must have at least 16 characters). No tokens are included. Run `npm run dev`; the default address is `http://localhost:4001`. Missing API authorization configuration fails closed. Use a synthetic, separate database for development. Do not point local development at the existing deployment database.

The browser and library API have no app login: access is restricted by the private Tailscale network. Everyone permitted to reach the service shares the library, reading history, and preferences. Keep Compose bound to localhost and expose it through Tailscale Serve over HTTPS; do not publish the reader to the internet or LAN. Ingestion and feedback retain independent Bearer tokens. Preserve Authorization and Host headers through the proxy and disable caching of private responses. Compose mounts `./data:/app/data` without mailbox credentials.

## API and operations

- [API contract and examples](docs/API.md), with [input JSON Schema](docs/ingest.schema.json). Runtime URL/control-character/duplicate-ID checks supplement JSON Schema.
- [Backup, migration, deployment, cutover, and rollback](docs/OPERATIONS.md). Preserve the existing database; do not use Drizzle push to replace its schema.
- [Navigation configuration](config/navigation.json). Source identities are independent of categories and email senders.
- [Local analytics](analytics/README.md). The read-only engagement API is the preferred assistant feedback interface.

`MAIL_DIGESTER_ALLOWED_SOURCES` defaults to `tldr,tldr-ai`. Expand it only for explicitly selected reading publications. A sender or domain is not enough to distinguish newsletters from account notices or operational alerts. The assistant owns mailbox/message allowlisting and stable, mailbox-scoped message identity.

## Verification

```bash
npm run check
npm run test:coverage
npm run build
npm run test:e2e
```

The E2E server uses a fresh temporary SQLite database and a separate headless browser. All fixtures are synthetic. Desktop/mobile screenshots are written to ignored `qa/`. No test reads Gmail or production data. Run `npm run api:schema` after changing the ingestion contract to regenerate its input JSON Schema.

Legacy database tables, item IDs, reading states, classifications, cached articles, and interaction history are retained. Mailbox retrieval can return later as a producer of the ingestion API. Follow the backup and migration procedure before deploying over an existing database.

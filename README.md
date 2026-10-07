# Mail Digester

A private, single-reader library fed by structured email/link data. The assistant selects sources, extracts descriptions, and categorizes items; this service persists and renders those items and records explicit reader engagement. It contains no Gmail access, mailbox polling, OpenAI calls, or scheduled ingestion.

The reader has configurable category tabs and subtabs. AI → TLDR combines TLDR and TLDR AI while keeping each publication and appearance identifiable. Narrative newsletters can be shown without a link. Descriptions are plain text. There is no special AI feature list, automatic article fetch, remote image loading, or tracking pixel.

## Local setup

Use Node 24 LTS and `npm ci`. Copy `.env.example` to `.env.local`. Run `npm run dev`; the default address is `http://localhost:4001`. Create API keys in Admin settings. Use a synthetic, separate database for development. Do not point local development at the existing deployment database.

The browser and library API have no app login: access is restricted by the private Tailscale network. Everyone permitted to reach the service shares the library, reading history, preferences, and Admin settings. Keep Compose bound to localhost and expose it through Tailscale Serve over HTTPS; do not publish the reader to the internet or LAN. API clients use scoped Bearer keys. Preserve Authorization and Host headers through the proxy and disable caching of private responses. Compose mounts `./data:/app/data` without mailbox credentials.

## CLI and agent skill

Install or update directly from the private repository using your GitHub SSH access:

```bash
npm i -g git+ssh://git@github.com/DimaPhil/mail-digester.git
mail-digester --help
mail-digester auth login
mail-digester inbox
mail-digester ingest --file /private/path/issue.json
mail-digester engagement --after 0 --limit 100
```

Create a key in the reader's **Admin settings**, then paste it into the hidden login prompt. Login verifies the key and saves it in `~/.lilfeel/mail-digester/config.json` with mode 0600. Alternatively, use the globally defined `MAIL_DIGESTER_API_KEY`; it overrides the saved key. No key goes in command arguments. `auth status` shows metadata; `auth logout` deletes the saved credential without revoking the remote key.

The default server is `https://lilfeel-ai-mf.tail52362f.ts.net:8443`. Override it with `--url` or `MAIL_DIGESTER_URL`. Saved credentials apply only to their server origin. HTTPS is required except on localhost. JSON goes to stdout; errors go to stderr with a nonzero exit code. Use `--file PATH` or `--file -` for structured request bodies. Run `--help` for all item actions and key management commands.

Global installation also installs the bundled [agent skill](skills/mail-digester/SKILL.md) into `~/.agents/skills/mail-digester` and creates a relative `~/.claude/skills/mail-digester` symlink. Updates refresh the managed skill. Conflicting user-owned skills are preserved and installation fails with an explanation. Lifecycle scripts must be enabled for automatic installation; if your npm policy disables them, run `mail-digester skill install`. Repository-local `npm ci` does not touch your home skills.

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

The E2E server uses a fresh temporary SQLite database and a separate headless browser. All fixtures are synthetic. Desktop/mobile screenshots are written to ignored `qa/`. No test reads Gmail or production data.

REST routes, request validation, CLI commands, options, and help share [lib/api/contracts.ts](lib/api/contracts.ts). After changing it, run `npm run api:contracts`; ingestion schema changes also require `npm run api:schema`. `npm run api:check` fails on stale generated data, unregistered endpoints, missing routes, or routes bypassing the shared wrapper. This runs in CI and pre-push checks. The CLI E2E test must exercise every registered command. CLI requests and API responses carry a contract fingerprint; incompatible versions fail a read-only preflight, and the server checks each submitted fingerprint before executing the operation. Update CLI and server together when the contract changes. [AGENTS.md](AGENTS.md) records the maintenance rules for coding agents.

Legacy database tables, item IDs, reading states, classifications, cached articles, and interaction history are retained. Mailbox retrieval can return later as a producer of the ingestion API. Follow the backup and migration procedure before deploying over an existing database.

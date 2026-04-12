# Mail Digester

Mail Digester is a single-user web app for clearing unread TLDR newsletters quickly.
It ingests unread TLDR-family emails from Gmail via `gws`, turns each newsletter into
individual reading items, extracts readable article views inline, and marks the
original Gmail message as read once every item in that email has been resolved.

## Stack

- Next.js App Router + React + TypeScript
- SQLite + Drizzle ORM
- Tailwind CSS + Radix UI primitives
- `gws` as the Gmail adapter
- Vitest for unit coverage
- Playwright for end-to-end flows
- ESLint + Prettier + Husky + lint-staged

## Features

- Startup sync and manual refresh for unread TLDR-family mail
- Provider boundary for future non-Gmail adapters
- Source parser boundary for future non-TLDR digests
- Per-item resolution with undo
- Automatic Gmail `UNREAD` removal once an issue is fully processed
- Visible loading/progress states for sync, article extraction, and resolve actions
- Fixture-backed test mode that runs without Gmail or external article fetches

## Local Development

Prerequisites:

- Node 20+
- `gws` installed and authenticated for Gmail access

Install and run:

```bash
npm install
npm run dev
```

By default the app runs on [http://localhost:4001](http://localhost:4001).
Override the port with `PORT`, for example:

```bash
PORT=4010 npm run dev
```

## Environment

Optional environment variables:

- `MAIL_DIGESTER_DB_PATH`: override the SQLite file location
- `PORT`: override the application port, default `4001`
- `GWS_BINARY`: override the `gws` executable path
- `GMAIL_TLDR_QUERY`: override the Gmail unread query
- `MAIL_DIGESTER_GWS_CONFIG_DIR`: host path mounted into Docker for `gws` auth data, default `/home/lilfeel/.config/gws`
- `MAIL_DIGESTER_USE_FIXTURE_DATA=1`: use local fixture mail instead of Gmail
- `MAIL_DIGESTER_TEST_ARTICLE_BASE_URL`: base URL embedded into fixture newsletter links

## Docker And Dockge Deployment

The repo includes:

- [Dockerfile](/Users/dmitryfilippov/Documents/work/personal/mail-digester/Dockerfile)
- [compose.yaml](/Users/dmitryfilippov/Documents/work/personal/mail-digester/compose.yaml)
- health endpoint at [app/api/health/route.ts](/Users/dmitryfilippov/Documents/work/personal/mail-digester/app/api/health/route.ts)

Production defaults:

- app listens on container port `4001`
- compose publishes `4001:4001`
- SQLite persists in `./data`
- `gws` is installed in the container image
- host `gws` auth/config is mounted from `${MAIL_DIGESTER_GWS_CONFIG_DIR:-/home/lilfeel/.config/gws}`

For Dockge on the Ubuntu host, place the repo in the Dockge stacks directory and start the stack from `compose.yaml`.

## Verification

Core verification commands:

```bash
npm run check
npm run test:coverage
npm run build
npm run test:e2e
npm run verify:full
```

Coverage is enforced at 80%+ in Vitest.

## Hooks And CI

- `pre-commit`: `lint-staged` + TypeScript typecheck
- `pre-push`: full verify pass + Playwright e2e
- GitHub Actions CI runs on Ubuntu 24.04 and executes verify, build, and e2e

## Fixture Mode

Fixture mode is used for deterministic tests and CI:

- newsletter ingestion uses a local mail provider instead of Gmail
- article extraction resolves fixture article URLs in-process
- Playwright runs against the real app UI with fixture data enabled

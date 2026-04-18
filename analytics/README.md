# Analytics

Scripts for turning `item_interactions` rows into early interest signals and
exporting them from the Ubuntu server in LLM-friendly formats. They are
intentionally conservative: until enough events exist, the output will say that
the sample is too small and avoid strong filtering recommendations.

## Model

The current scoring model treats behavior as preference evidence:

- `description_expand`: weak positive signal. The short blurb was not enough,
  but the user still stayed in the inbox instead of opening the article.
- `link_open`: positive signal. The item was interesting enough to open.
- `resolve` with `resolve_mode = after_open`: strong positive signal. The item
  was opened and then cleared.
- `resolve` with `resolve_mode = direct`: negative signal. The item was cleared
  without opening the link.
- `unresolve`: weak positive signal. Undo means the item may still matter.

The scripts aggregate those signals by:

- TLDR source variant, for example `TLDR` or `TLDR AI`
- newsletter section
- item kind, for example `editorial`, `sponsor`, or `discussion`
- keywords extracted from title and full description
- title phrases
- individual items

This should be enough to bootstrap future automated filtering without deciding
too early from a tiny sample.

## What Gets Tracked

Every interaction row snapshots the newsletter item state at the time of the
action, including direct resolves where the article was never opened:

- `title`
- `fullDescription` from the newsletter body
- source metadata such as `sourceVariant`, `section`, `itemKind`
- URLs: `trackedUrl`, `canonicalUrl`, `finalUrl`
- resolve metadata, including whether the item was opened before resolving

When an article has been opened and extracted, analytics exports also join the
cached `article_snapshots` data when available:

- `snapshotStatus`
- `snapshotTitle`
- `snapshotByline`
- `snapshotSiteName`
- `snapshotExcerpt`
- `snapshotContentText`

This means unresolved-via-click and direct-resolve behaviors are both useful for
later filtering analysis. Direct resolves always keep the newsletter title and
description; opened items can additionally contribute article text.
Description expansions add a middle-ground signal when the user wanted more
context from the newsletter itself but did not open the destination link.

## Interest Analysis

Run against the Ubuntu server DB. The npm commands SSH to the server and execute
the scripts inside the running `mail-digester` container, because the metrics
are stored in the server SQLite volume, not in the local development DB.

```bash
npm run analytics:interests
```

Override the server if needed:

```bash
MAIL_DIGESTER_SSH_HOST=lilfeel@lilfeel-ai-mf npm run analytics:interests
```

When already SSHed into Ubuntu, run the container-local wrapper directly:

```bash
cd /home/lilfeel/Documents/mail-digester
analytics/run-in-container.sh interests
```

JSON output:

```bash
npm run analytics:interests:json
```

Useful flags:

- `--db <path>`: SQLite DB path, defaults to `MAIL_DIGESTER_DB_PATH` or `./data/mail-digester.sqlite`
- `--format markdown|json`: output format
- `--out <path>`: write output to a file
- `--top <n>`: number of rows per section, default `12`
- `--min-samples <n>`: readiness threshold, default `30`
- `--since-days <n>`: analyze only recent events

For an intentionally local analysis against a copied DB, bypass the npm wrapper:

```bash
node analytics/analyze-interests.mjs --db ./data/mail-digester.sqlite
```

## LLM Context

Generate a prompt-ready Markdown bundle with instructions, a future app-side
filter-rule contract, aggregate counts, and item evidence including source
variant, title, full description, and article snapshot previews when available:

```bash
npm run analytics:llm-context -- --out analytics/out/llm-context.md
```

JSON is also available for programmatic workflows:

```bash
npm run analytics:llm-context:json -- --out analytics/out/llm-context.json
```

On Ubuntu:

```bash
cd /home/lilfeel/Documents/mail-digester
analytics/run-in-container.sh llm-context --out /tmp/mail-digester-llm-context.md
```

Suggested workflow after a few complete emails:

- Run `npm run analytics:llm-context`.
- Paste the output into an LLM and ask it to return JSON that matches `analytics/filter-recommendations.schema.json`.
- Review only high-confidence, easy-to-undo suggestions before enabling any filter.
- Use the same schema later inside the app when adding persisted filtering rules.
- Keep collecting raw interactions so future rules can be validated against behavior.

## Raw Export

Export interaction rows for ad-hoc analysis:

```bash
npm run analytics:export -- --format jsonl --out analytics/out/interactions.jsonl
npm run analytics:export -- --format csv --out analytics/out/interactions.csv
```

On Ubuntu:

```bash
cd /home/lilfeel/Documents/mail-digester
analytics/run-in-container.sh export --format jsonl --out /tmp/mail-digester-interactions.jsonl
```

`analytics/out/` is gitignored.

## Ubuntu-First Workflow

The metrics live in the Ubuntu Docker volume. Use one of these paths:

- Local machine to remote Ubuntu via SSH:
  `npm run analytics:export -- --format jsonl --out analytics/out/interactions.jsonl`
- Already on Ubuntu:
  `./analytics/run-in-container.sh export --format jsonl --out /tmp/mail-digester-interactions.jsonl`
- LLM-ready bundle from Ubuntu:
  `./analytics/run-in-container.sh llm-context --out /tmp/mail-digester-llm-context.md`

The `llm-context` output is the preferred handoff for an LLM. The raw `export`
output is better for custom offline analysis or building future importers.

# Reading service API v1

Use the private Tailscale HTTPS address and disable caching of private responses. [Setup](../README.md#local-setup) describes the network access boundary and separate ingestion/feedback tokens. Imported descriptions are untrusted plain text.

## Read library

`GET /api/inbox` requires Tailscale access, with no app credentials. It returns `{ navigation, emails }`; every email includes its items with `id`, `title`, `summary`, `safeUrl`, `resolvedAt`, `preference`, and `collections`. `resolvedAt: null` means To read. This is the same endpoint the browser uses; it returns the full library without server-side filtering or pagination. Apply filters in the client.

```bash
READING_BASE_URL=https://lilfeel-ai-mf.tail52362f.ts.net:8443
curl --fail-with-body "$READING_BASE_URL/api/inbox" \
  | jq '.emails[].items[] | select(.resolvedAt == null) | {id, title, url: .safeUrl, collections}'
```

For AI → TLDR, filter items with `any(.collections[]; .categoryId == "ai" and .tabId == "tldr")`. A single item may have multiple memberships but occurs only once in the library response.

## Ingestion

`POST /api/v1/ingest` requires `Authorization: Bearer <ingestion token>` and `Content-Type: application/json`. The source ID must be in `MAIL_DIGESTER_ALLOWED_SOURCES`; feedback tokens cannot ingest.

```json
{
  "source": { "id": "tldr", "label": "TLDR" },
  "message": {
    "id": "synthetic-mailbox-a:issue-2026-10-03",
    "subject": "A synthetic reading issue",
    "receivedAt": "2026-10-03T08:00:00Z"
  },
  "items": [
    {
      "id": "story-1",
      "title": "A field guide to learning systems",
      "description": "A concise, plain-text description.",
      "url": "https://example.com/research",
      "collections": [
        {
          "categoryId": "ai",
          "categoryLabel": "AI",
          "tabId": "research",
          "tabLabel": "News & Research"
        }
      ]
    }
  ]
}
```

```bash
curl --fail-with-body "$READING_BASE_URL/api/v1/ingest" \
  -H "Authorization: Bearer $MAIL_DIGESTER_INGEST_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @/private/path/reading-payload.json
```

The generated [input schema](ingest.schema.json) defines fields, defaults, and limits. Message `senderName`, `senderEmail`, and `description` default to empty strings. Items require only `id` and `title`; `section` defaults to Reading and `kind` to editorial. Omit `url` for a narrative newsletter. Raw mail HTML, mailbox credentials, arbitrary metadata, and unknown fields are rejected.

Collection IDs and labels must match [navigation.json](../config/navigation.json). Multiple memberships share one item and reading state. Omitted collections use the [source catalog](../config/source-catalog.json) default; sources without a default require an explicit collection. Both TLDR editions also appear in AI → TLDR. Legacy sources without a route remain reachable under Unsorted. Sponsored items stay stored but are hidden by default.

### Identity and replay

Use stable lowercase source slugs, distinct for TLDR and TLDR AI even when senders match. Message IDs must be unique within a source across mailboxes, using an opaque mailbox namespace or deterministic hash. Item IDs identify appearances within a message; do not derive retry identity from array position, rewritten titles, or randomness.

- New items return `201`; exact replay returns `200`, unchanged internal IDs, and `createdItems: 0`.
- Omitted items are retained. Appending items reopens the issue without clearing old reading state. Reordering requests does not reorder stored items.
- Changed normalized message metadata, item content/collections, or source labels under an existing ID return `409`; the entire transaction rolls back. Review conflicts rather than inventing new IDs to bypass them.
- Separate appearances across issues remain separate. Canonical URLs strip common tracking parameters for destination grouping; the server never fetches them.
- Ingestion emits no engagement. There are no replacement or delete routes.

```json
{
  "messageId": "synthetic-mailbox-a:issue-2026-10-03",
  "internalEmailId": 1,
  "createdItems": 1,
  "items": [{ "id": "story-1", "internalId": 1, "created": true }]
}
```

### Legacy replay

Prefer a cutover watermark and ingest new messages only. To replay a stored Gmail issue, supply `message.origin: {"provider":"gmail","messageId":"existing-provider-id"}` and every item's `legacyItemId`. Mapping checks message ownership and supplied URL compatibility, preserving original content, IDs, timestamps, and reading state. Missing mappings return `409`; one legacy message cannot have two ingestion identities. New navigation can be attached without rewriting the old item.

An origin not already stored is ingested normally. The service never contacts Gmail. Keep mappings/checkpoints private, and check legacy provider-ID scoping before replaying across mailboxes. See [migration](OPERATIONS.md).

### Validation and errors

Bodies are streamed with a 512,000-byte limit, including without Content-Length. Runtime checks supplement the schema: configured collections, unique item IDs, safe control characters, and public HTTP(S) URLs without credentials or nonstandard ports. Local/internal destinations and private/reserved literal IPs are rejected. Text is rendered escaped. DNS is not resolved; a reader-opened external website can still redirect the browser.

Statuses: `200` replay/mapping; `201` new items; `400` invalid input; `401` wrong/missing token; `403` disabled source; `409` identity conflict; `503` missing/short or shared API secrets. Secrets require at least 16 characters and distinct values.

## Read-only engagement

`GET /api/v1/engagement?after=0&limit=100` requires the feedback Bearer token. `after` is an exclusive interaction-ID cursor, default 0; `limit` is 1–500, default 100. Invalid cursors/limits return `400`.

Responses contain `events`, `nextCursor`, and `hasMore`, ordered by ID. Persist the last successfully processed cursor privately. Events include original snake_case interaction snapshots, internal IDs, content, provenance, Unix-millisecond timestamps, and `actor`. `api_source_id`, `api_message_id`, and `api_item_id` are present when mapped and may be null for legacy history.

| Action               | Meaning                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `description_expand` | Expanded the supplied description.                                                          |
| `reader_open`        | Opened inline details; not an outbound click.                                               |
| `link_open`          | Explicitly opened an external story.                                                        |
| `resolve`            | Marked Done; `resolve_mode=after_open` when a persisted link-open exists, otherwise direct. |
| `unresolve`          | Restored a resolved item.                                                                   |
| `preference`         | `metadata_json.signal` is interested, less_like_this, or clear.                             |

Repeated Done/Restore or the current preference are no-ops. Use the latest explicit preference per appearance; clear withdraws it. Direct Done is ambiguous. New reader events have `actor=human`; historical events retain unknown actors. Exclude unknown actors and `bulkResolveMode` automation from learning. [Local analytics](../analytics/README.md) describes recommendation scoring. Keep real payloads and feedback exports outside public artifacts.

## Browser routes

The reader uses `/api/inbox` and POST `/api/items/:id/{open,link-open,description-expand,resolve,unresolve,preference}` over the private network without app credentials. Preference takes `{ "signal": "interested" }`, less_like_this, or clear; other actions accept no client metadata. IDs must be positive integers. Cross-origin browser mutations are rejected. All readers share history and preferences.

Retired `/api/sync`, `/api/config`, `/api/ai-feature-list`, and `/api/items/resolve-not-interesting` endpoints return `410` without doing work.

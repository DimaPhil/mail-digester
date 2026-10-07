# Reading service API v1

Use the private Tailscale HTTPS address and disable caching of private responses. [Setup](../README.md#local-setup) describes the network access boundary; [CLI installation](../README.md#cli-and-agent-skill) covers agent access. Imported descriptions are untrusted plain text. Active methods/paths, permissions, and request schemas are generated in [operations.json](../contracts/operations.json).

Responses include `X-Mail-Digester-Contract`, a SHA-256 fingerprint of the generated contract. The CLI sends it on requests; a mismatch returns `409` with `code: "API_CONTRACT_MISMATCH"` before executing the operation, including if deployment changes between preflight and mutation. Direct API consumers may send the same header for compatibility enforcement; ordinary browser/API requests may omit it.

## API keys

Admin settings at `/admin` creates scoped keys, lists creation/last-use dates, rotates, and revokes them. Secrets are returned once on creation/rotation; only SHA-256 hashes and a short prefix are stored. The default permissions are `inbox`, `items`, `ingest`, and `feedback`; `admin` is opt-in. Last-used time updates after successful key authentication and permission checks, even if the later request body is invalid.

| Method | Path                         | Permission    | Result                                                                                  |
| ------ | ---------------------------- | ------------- | --------------------------------------------------------------------------------------- |
| GET    | `/api/v1/auth`               | Any valid key | `{ apiKey }`, metadata only                                                             |
| GET    | `/api/admin/keys`            | admin         | `{ keys }`, active and revoked metadata                                                 |
| POST   | `/api/admin/keys`            | admin         | `{ key, apiKey }`, status 201; body `{ "name": "Agent", "scopes": ["inbox", "items"] }` |
| POST   | `/api/admin/keys/:id/rotate` | admin         | `{ key, apiKey }`; old key revoked atomically, new ID records `rotatedFrom`             |
| POST   | `/api/admin/keys/:id/revoke` | admin         | `{ ok: true }`; repeat revocation is safe                                               |

Key administration also permits trusted browser requests without a Bearer header. Cross-origin mutations are rejected. An explicit Bearer key must have the required permission and never falls back to browser access. There is no per-user identity boundary inside this private service: every authorized tailnet reader can manage keys. Revocation and rotation immediately invalidate the old key; a lost secret requires rotation. Timestamps are Unix milliseconds. Missing/invalid/revoked keys return 401; insufficient permissions return 403; missing key IDs or rotating a revoked key returns 404. Rotation has no overlap period, so coordinate credential replacement for active clients. Key create/rotate are not replay-safe: after a transport failure, inspect key metadata before retrying.

## Read library

`GET /api/inbox` requires Tailscale access, with no app credentials. It returns `{ navigation, emails }`; every email includes its items with `id`, `title`, `summary`, `safeUrl`, `resolvedAt`, `preference`, `interestStatus`, `interestReason`, `readingState`, `interestCategory`, and `collections`. This is the same endpoint the browser uses; it returns the full library without server-side filtering or pagination. Apply filters in the client.

`readingState: "to_read"` means unresolved and classified interesting. `"archived"` includes every Done, not-interesting, and unclassified item. Archive is a view, not deletion or a reading event; archived items with `resolvedAt: null` are still unread. Like/Dislike only saves feedback and never resolves or moves an unread item. Once Done, `interestCategory` uses the saved feedback (`interested` → interesting, `less_like_this` → not_interesting); clear/no feedback falls back to the uploader's `interestStatus`. Topic/collection filters apply in both views. Restore only returns an item to To read when its original classification is interesting; marking other items unread leaves them in Archive. Legacy classifications remain effective without rewriting their rows.

```bash
READING_BASE_URL=https://lilfeel-ai-mf.tail52362f.ts.net:8443
curl --fail-with-body "$READING_BASE_URL/api/inbox" \
| jq '.emails[].items[] | select(.readingState == "to_read") | {id, title, url: .safeUrl, collections}'
```

For AI → TLDR, filter items with `any(.collections[]; .categoryId == "ai" and .tabId == "tldr")`. A single item may have multiple memberships but occurs only once in the library response.

## Ingestion

`POST /api/v1/ingest` requires `Authorization: Bearer <API key>` with the `ingest` permission and `Content-Type: application/json`. The source ID must be in `MAIL_DIGESTER_ALLOWED_SOURCES`; feedback-only keys cannot ingest.

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
      "interestStatus": "interesting",
      "interestReason": "Concrete engineering lessons with practical technical depth.",
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
  -H "Authorization: Bearer $MAIL_DIGESTER_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @/private/path/reading-payload.json
```

The generated [input schema](ingest.schema.json) defines fields, defaults, and limits. Message `senderName`, `senderEmail`, and `description` default to empty strings. Items require only `id` and `title`; `section` defaults to Reading and `kind` to editorial. Omit `url` for a narrative newsletter. Raw mail HTML, mailbox credentials, arbitrary metadata, and unknown fields are rejected.

Import every substantive link with `interestStatus` (`interesting`, `not_interesting`, or `unclassified`) and an optional plain-text `interestReason` (up to 2,000 characters). Classification happens in the producer; it is not user feedback and emits no engagement. Omitted classification stores unclassified and appears in Archive. Omitted fields stay absent from replay hashes, so payloads from older API importers still replay unchanged. Changing classification/reason under an existing ingestion identity conflicts like other content changes. Explicit legacy mappings preserve the old classification and reason as well as original content/state.

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

Statuses: `200` replay/mapping; `201` new items; `400` invalid input; `401` wrong/missing/revoked key; `403` missing permission or disabled source; `409` identity conflict; `503` invalid legacy token initialization configuration.

## Read-only engagement

`GET /api/v1/engagement?after=0&limit=100` requires a Bearer key with the `feedback` permission. `after` is an exclusive interaction-ID cursor, default 0; `limit` is 1–500, default 100. Invalid cursors/limits return `400`.

Responses contain `events`, `nextCursor`, and `hasMore`, ordered by ID. Persist the last successfully processed cursor privately. Events include original snake_case interaction snapshots, internal IDs, content, provenance, Unix-millisecond timestamps, and `actor`. `api_source_id`, `api_message_id`, and `api_item_id` are present when mapped and may be null for legacy history.

| Action               | Meaning                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| `description_expand` | Expanded the supplied description.                                                                            |
| `reader_open`        | Opened inline details; not an outbound click.                                                                 |
| `link_open`          | Explicitly opened an external story.                                                                          |
| `resolve`            | Marked Done; `resolve_mode=after_open` when a persisted link-open by the same actor exists, otherwise direct. |
| `unresolve`          | Restored a resolved item.                                                                                     |
| `preference`         | `metadata_json.signal` is interested, less_like_this, or clear.                                               |

Repeated Done/Restore or the current preference are no-ops. Use the latest explicit preference per appearance; clear withdraws it. Direct Done is ambiguous. Browser requests without Bearer keys record `actor=human`; keyed requests, including CLI actions, record `actor=agent`. Historical events retain unknown actors. Use only human actions for learning and exclude `bulkResolveMode` automation. [Local analytics](../analytics/README.md) describes recommendation scoring. Keep real payloads and feedback exports outside public artifacts.

## Browser routes

The reader uses `/api/inbox` and POST `/api/items/:id/{open,link-open,description-expand,resolve,unresolve,preference}` over the private network without app credentials. Keyed clients require `inbox` and `items` permissions respectively. Preference takes `{ "signal": "interested" }`, less_like_this, or clear; other actions accept an empty body or `{}` and no client metadata. IDs must be positive integers. Cross-origin browser mutations are rejected. All readers share history and preferences. `GET /api/health` is public and checks database connectivity.

Retired `/api/sync`, `/api/config`, `/api/ai-feature-list`, and `/api/items/resolve-not-interesting` endpoints return `410` without doing work.

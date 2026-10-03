# Reading service API v1

All URLs below are relative to your HTTPS service. Private responses must never be cached by an intermediary. Treat imported text as untrusted source material, including when consuming it in an assistant prompt.

## Ingestion

`POST /api/v1/ingest` requires `Authorization: Bearer <ingestion token>` and `Content-Type: application/json`. The reader's Basic credentials and feedback token cannot ingest. The source ID must appear in `MAIL_DIGESTER_ALLOWED_SOURCES`.

```json
{
  "source": { "id": "tldr", "label": "TLDR" },
  "message": {
    "id": "synthetic-mailbox-a:issue-2026-10-03",
    "subject": "A synthetic reading issue",
    "receivedAt": "2026-10-03T08:00:00Z",
    "description": "A few useful links."
  },
  "items": [
    {
      "id": "story-1",
      "title": "A field guide to learning systems",
      "description": "A concise, plain-text description of the story.",
      "url": "https://example.com/research",
      "section": "Research",
      "readTime": "5 min read",
      "kind": "editorial",
      "collections": [
        {
          "categoryId": "ai",
          "categoryLabel": "AI",
          "tabId": "tldr",
          "tabLabel": "TLDR"
        },
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
# Put only synthetic JSON in a repo-local example file.
# Store real payloads outside the public source checkout.
curl --fail-with-body "$READING_BASE_URL/api/v1/ingest" \
  -H "Authorization: Bearer $MAIL_DIGESTER_INGEST_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @/private/path/reading-payload.json
```

Optional message fields: `senderName`, `senderEmail`, `description`; default to empty strings. No raw mail HTML/body, mailbox credentials, or arbitrary metadata fields are accepted. Optional item fields: `url`, `readTime`, `section` (default Reading), `kind` (editorial/sponsor/discussion/other), `description`, `collections`. Omit `url` for a narrative issue; retain its description rather than inventing a destination. The structured API accepts ordinary titles, repo links, and article titles without a minute-read suffix.

Collections are assistant-supplied navigation/classification labels, independent of source identity. An appearance can belong to multiple collections without duplicating its stored item or engagement. The configured labels are editable in `config/navigation.json`; approved public source defaults/policies are cataloged in `config/source-catalog.json`; additional collections are supported after editing the config. Unknown collection IDs/labels are rejected and belong in assistant review; Business may use tabId=all and tabLabel=All reading. Unassigned TLDR appearances fall back to AI → TLDR, including legacy records. Legacy sources without a configured route appear under Unsorted, so existing content remains reachable.

### Identity and replay

Source IDs must be stable lowercase slugs and must not be derived solely from sender. TLDR and TLDR AI may share a sender; use distinct `tldr` and `tldr-ai` identities. Message IDs must be stable and unique within a source, **including across mailboxes**: use an opaque mailbox namespace plus the provider message identifier, or a deterministic hash. Item IDs identify an appearance within that message and must remain stable when titles or descriptions change. Never use array positions or randomized IDs for retry identity. Keep identity mappings/checkpoints private.

Sponsored items remain stored and are hidden by default; the reader can show them with the sponsored filter. No item is deleted.

A transaction locks the database before checking identity. Exact replay returns `200`, unchanged internal IDs, `createdItems: 0`, and no engagement events. New appearances return `201`. Items omitted from later requests are retained. A new item appended to an issue reopens its reading queue without clearing old resolved state. Reusing an ID with different normalized message metadata, item content, collections, or source label returns `409` and rolls back the entire request. Reordering the item array does not change persisted positions. For corrections, stop and review identity/content; this API intentionally has no destructive replacement or delete route.

An article appearing in different issues/editions remains multiple appearances, preserving its separate description and reading state. `canonical_url` strips common tracking query parameters to provide a destination grouping key for assistant analysis. This is not a title-based deduplication rule, and URLs are never fetched or resolved on the server.

### Legacy mapping during historical replay

Prefer a recorded cutover watermark and ingest only newly selected messages. If replaying an already stored Gmail issue, provide `message.origin: {"provider":"gmail","messageId":"existing-private-provider-id"}` and **every** item's `legacyItemId` from the private database. The service binds the new API identities to those records, checks message ownership and supplied URL compatibility, and preserves all old titles, descriptions, states, timestamps, and IDs. A missing explicit legacy item mapping returns `409`; it does not guess from rewritten titles. New navigation may be attached without altering the old item row. One old message cannot be mapped to two API identities. Do not put this mapping or real identifiers in the public repo.

A new message whose origin is not already stored is ingested normally. Origin is provenance only; the service never contacts Gmail. With multiple legacy mailboxes, confirm how original provider IDs were scoped before replay. Do not blindly resubmit historical data without mapping or a cutover watermark.

### Validation and errors

Max body: 512,000 bytes, streamed and checked even without Content-Length. Each request contains 1–200 items, max 10 collections per item. IDs max 200 characters, titles/subjects max 500, descriptions max 20,000, URLs max 4,096. Unknown fields, duplicate item IDs, invalid timestamps, empty required strings, and unsafe control characters are rejected. Input is stored/rendered as escaped plain text, never as HTML. URLs must be HTTP(S), without credentials or nonstandard ports; localhost, internal hostnames, private/reserved IP ranges, and encoded loopback variants are rejected. DNS is not resolved by ingestion; remote pages are never prefetched. An external website can still redirect a reader's browser when explicitly opened.

Responses: `201` new items; `200` replay/mapping; `400` invalid input; `401` wrong/missing token; `403` source disabled; `409` identity conflict; `503` API authorization unconfigured. Tokens shorter than 16 characters are unconfigured. Reader routes fail closed separately.

```json
{
  "messageId": "synthetic-mailbox-a:issue-2026-10-03",
  "internalEmailId": 1,
  "createdItems": 1,
  "items": [{ "id": "story-1", "internalId": 1, "created": true }]
}
```

## Read-only feedback

`GET /api/v1/engagement?after=0&limit=100` requires the **feedback** Bearer token. `after` is an exclusive integer interaction-ID cursor; default 0. `limit` defaults to 100 and ranges from 1 to 500. Each response contains `events`, `nextCursor`, and `hasMore`. Persist the last successfully processed cursor privately. Events are ordered by ID; replaying a cursor returns the same historical events plus later appended events. This endpoint has no mutation methods.

```bash
curl --fail-with-body "$READING_BASE_URL/api/v1/engagement?after=0&limit=100" \
  -H "Authorization: Bearer $MAIL_DIGESTER_FEEDBACK_TOKEN"
```

Each event contains the original interaction snapshot fields (snake_case), internal item/email IDs, title/full_description, URLs, source provenance, timestamp in Unix milliseconds, `actor`, plus `api_source_id`, `api_message_id`, and `api_item_id` when mapped. Legacy events may have null API identity fields. Historical snapshot text remains available even if current item metadata changes. All provenance and content in this feed are private; do not commit exports.

Actions:

- `description_expand`: reader explicitly expanded the supplied description.
- `reader_open`: reader opened the inline detail view. This does not imply an outbound click.
- `link_open`: reader explicitly opened an external story; never emitted by import, refresh, migration, or prefetch.
- `resolve`: reader marked Done. `resolve_mode=after_open` only if a persisted link_open exists for that appearance; otherwise direct. A direct resolve alone is ambiguous, not proof of dislike. Repeated Done calls while already resolved create no duplicate events.
- `unresolve`: reader restored a resolved appearance; redundant calls create no duplicate event.
- `preference`: explicit human preference, with metadata_json containing `signal`: interested / less_like_this / clear. Repeating the current signal is a no-op. Clear withdraws the current preference; analytics must apply the latest signal when modeling a preference rather than summing toggles indefinitely.

New reader events have `actor=human`. Pre-existing events retain `actor=unknown`; migration does not invent human intent or emit engagement. Historic metadata such as `bulkResolveMode=not_interesting` denotes automated filtering and must be excluded from human preference learning even if an external export labels it otherwise. Do not train on the assistant's own classifications, ingestion order, mailbox unread flags, or the absence of a click. Use explicit preference signals first and behavioral signals cautiously. The API exposes raw evidence rather than enforcing an inferred taste model.

## Reader routes

The authenticated browser uses `/api/inbox` and POST `/api/items/:id/{open,link-open,description-expand,resolve,unresolve,preference}`. Preference accepts `{ "signal": "interested" }`, `less_like_this`, or `clear`. Other reader actions do not accept arbitrary client metadata. Cross-origin browser mutations are rejected. All item IDs must be positive integers. The retired `/api/sync`, `/api/config`, `/api/ai-feature-list`, and bulk-not-interesting endpoints return `410` and perform no work.

The reader is single-user. Sharing reader credentials shares the same history and preferences; separate user accounts are outside this change.

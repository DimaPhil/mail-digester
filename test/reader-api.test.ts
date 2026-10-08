import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import inputSchema from "../docs/ingest.schema.json";
import { ingestSchema } from "@/lib/api/ingest";
import { safeExternalUrl } from "@/lib/content/safety";
import {
  fingerprint,
  backupDatabase,
  verifyPreserved,
} from "../scripts/db-maintenance.mjs";

const fixture = {
  source: { id: "tldr", label: "TLDR" },
  message: {
    id: "synthetic-issue-1",
    subject: "A synthetic reading issue",
    receivedAt: "2026-10-03T08:00:00Z",
  },
  items: [
    {
      id: "story-1",
      title: "A thoughtful engineering story",
      description: "Plain text <script>alert(1)</script>",
      url: "https://example.com/story?utm_source=sample",
      collections: [
        {
          categoryId: "ai",
          categoryLabel: "AI",
          tabId: "tldr",
          tabLabel: "TLDR",
        },
      ],
    },
  ],
};
let dir: string;
let db: Database.Database;
async function setup() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "reader-synthetic-"));
  process.env.MAIL_DIGESTER_DB_PATH = path.join(dir, "synthetic.sqlite");
  process.env.MAIL_DIGESTER_INGEST_TOKEN = "synthetic-ingest-test-only";
  process.env.MAIL_DIGESTER_FEEDBACK_TOKEN = "synthetic-feedback-test-only";
  delete globalThis.__mailDigesterDb;
  vi.resetModules();
  const database = await import("@/lib/db");
  db = database.getSqlite();
  return {
    database,
    ingest: (await import("@/lib/api/ingest")).ingest,
    service: await import("@/lib/inbox/service"),
  };
}
afterEach(() => {
  db?.close();
  delete globalThis.__mailDigesterDb;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.MAIL_DIGESTER_DB_PATH;
  delete process.env.MAIL_DIGESTER_INGEST_TOKEN;
  delete process.env.MAIL_DIGESTER_FEEDBACK_TOKEN;
  delete process.env.MAIL_DIGESTER_ALLOWED_SOURCES;
});
const rows = (name: string) =>
  db.prepare(`SELECT * FROM ${name} ORDER BY id`).all();
it("saves preference and resolution atomically, preserves actors, and retries without duplicate events", async () => {
  const { ingest, service } = await setup();
  const result = ingest(
    ingestSchema.parse({
      ...fixture,
      items: [
        { ...fixture.items[0], id: "positive", interestStatus: "interesting" },
        { ...fixture.items[0], id: "negative", interestStatus: "interesting" },
      ],
    }),
  );
  const [positive, negative] = result.items.map((item) => item.internalId);
  const baseline = fingerprint(db);
  db.exec(
    "CREATE TRIGGER synthetic_resolve_failure BEFORE UPDATE OF resolved_at ON items BEGIN SELECT RAISE(ABORT, 'Synthetic save failure'); END",
  );
  await expect(
    service.resolveItem(positive, {}, "human", true, "interested"),
  ).rejects.toThrow(/Synthetic save failure/);
  expect(fingerprint(db, baseline)).toEqual(baseline);
  db.exec("DROP TRIGGER synthetic_resolve_failure");
  for (const [id, actor, signal, category] of [
    [positive, "human", "interested", "interesting"],
    [negative, "agent", "less_like_this", "not_interesting"],
  ] as const) {
    await service.recordLinkOpen(id, {}, actor);
    const saved = await service.resolveItem(id, {}, actor, true, signal);
    expect(saved).toMatchObject({
      item: {
        id,
        resolvedAt: expect.any(Number),
        preference: signal,
        readingState: "archived",
        interestCategory: category,
      },
    });
    expect(await service.resolveItem(id, {}, actor, true, signal)).toEqual(
      saved,
    );
    expect(rows("item_interactions").slice(-3)).toMatchObject([
      { action: "link_open", actor },
      {
        action: "preference",
        actor,
        metadata_json: JSON.stringify({ signal }),
      },
      { action: "resolve", actor, resolve_mode: "after_open" },
    ]);
  }
  expect(rows("item_interactions")).toHaveLength(6);
  expect(rows("emails")[0]).toMatchObject({
    resolved_items: 2,
    completion_state: "complete",
  });
  const { POST } = await import("@/app/api/items/[id]/resolve/route");
  for (const body of [
    { signal: "clear" },
    { signal: "invalid" },
    { signal: "interested", extra: true },
  ]) {
    expect(
      (
        await POST(
          new Request(
            `http://localhost/api/items/${positive}/resolve?compact=1`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            },
          ),
          { params: Promise.resolve({ id: String(positive) }) },
        )
      ).status,
    ).toBe(400);
  }
  expect(rows("item_interactions")).toHaveLength(6);
});
it("returns confirmed item state without rebuilding the library for compact mutations", async () => {
  const { ingest, service } = await setup();
  const id = ingest(
    ingestSchema.parse({
      ...fixture,
      items: [{ ...fixture.items[0], interestStatus: "interesting" }],
    }),
  ).items[0].internalId;
  const repository = await import("@/lib/db/repository");
  const list = vi.spyOn(repository, "listInboxEmails");
  try {
    expect(await service.setPreference(id, "less_like_this")).toMatchObject({
      ok: true,
      item: {
        id,
        preference: "less_like_this",
        resolvedAt: null,
        readingState: "to_read",
        interestCategory: "interesting",
      },
    });
    const resolved = await service.resolveItem(id, {}, "human", true);
    expect(resolved).toMatchObject({
      item: {
        id,
        resolvedAt: expect.any(Number),
        readingState: "archived",
        interestCategory: "not_interesting",
      },
    });
    expect(await service.resolveItem(id, {}, "human", true)).toEqual(resolved);
    expect(await service.setPreference(id, "clear")).toMatchObject({
      item: { interestCategory: "interesting", preference: "clear" },
    });
    expect(await service.unresolveItem(id, "human", true)).toMatchObject({
      item: { resolvedAt: null, readingState: "to_read" },
    });
    expect(list).not.toHaveBeenCalled();
    expect(await service.resolveItem(id)).toHaveProperty("emails");
    expect(list).toHaveBeenCalledOnce();
    await expect(service.unresolveItem(999, "human", true)).rejects.toThrow(
      /not found/,
    );
  } finally {
    list.mockRestore();
  }
});
it("stores all interest classifications, preserves old replay hashes, and separates feedback from reading state", async () => {
  const { ingest, service } = await setup();
  const oldPayload = ingestSchema.parse(fixture);
  expect(oldPayload.items[0]).not.toHaveProperty("interestStatus");
  const oldImport = ingest(oldPayload);
  const oldRows = rows("items");
  expect(ingest(ingestSchema.parse(fixture)).createdItems).toBe(0);
  expect(rows("items")).toEqual(oldRows);
  const input = ingestSchema.parse({
    ...fixture,
    message: { ...fixture.message, id: "classified-issue" },
    items: [
      {
        ...fixture.items[0],
        id: "positive",
        interestStatus: "interesting",
        interestReason: "Technical depth",
      },
      {
        ...fixture.items[0],
        id: "negative",
        interestStatus: "not_interesting",
      },
    ],
  });
  const result = ingest(input);
  expect(ingest(input).createdItems).toBe(0);
  expect(() =>
    ingest({
      ...input,
      items: [{ ...input.items[0], interestStatus: "not_interesting" }],
    }),
  ).toThrow(/differs/);
  const getItems = async () =>
    (await service.getInboxPayload()).emails.flatMap((email) => email.items);
  let all = await getItems();
  expect(
    all.find((item) => item.id === oldImport.items[0].internalId),
  ).toMatchObject({
    interestStatus: "unclassified",
    readingState: "archived",
    resolvedAt: null,
  });
  const [positive, negative] = result.items.map((item) => item.internalId);
  expect(all.find((item) => item.id === positive)).toMatchObject({
    interestStatus: "interesting",
    interestReason: "Technical depth",
    readingState: "to_read",
  });
  expect(all.find((item) => item.id === negative)).toMatchObject({
    interestStatus: "not_interesting",
    readingState: "archived",
    resolvedAt: null,
  });
  await service.setPreference(positive, "less_like_this");
  all = await getItems();
  expect(all.find((item) => item.id === positive)).toMatchObject({
    readingState: "to_read",
    resolvedAt: null,
    interestCategory: "interesting",
  });
  await service.resolveItem(positive);
  all = await getItems();
  expect(all.find((item) => item.id === positive)).toMatchObject({
    readingState: "archived",
    interestStatus: "interesting",
    interestCategory: "not_interesting",
    preference: "less_like_this",
  });
  await service.setPreference(positive, "clear");
  expect(
    (await getItems()).find((item) => item.id === positive)?.interestCategory,
  ).toBe("interesting");
  await service.unresolveItem(positive);
  expect(
    (await getItems()).find((item) => item.id === positive)?.readingState,
  ).toBe("to_read");
  await service.resolveItem(negative);
  await service.unresolveItem(negative);
  expect((await getItems()).find((item) => item.id === negative)).toMatchObject(
    { readingState: "archived", resolvedAt: null },
  );
  expect(
    rows("item_interactions").filter(
      (event: unknown) => (event as { action: string }).action === "preference",
    ),
  ).toHaveLength(2);
  expect(
    ingestSchema.safeParse({
      ...fixture,
      items: [{ ...fixture.items[0], interestStatus: "invented" }],
    }).success,
  ).toBe(false);
  expect(
    ingestSchema.safeParse({
      ...fixture,
      items: [{ ...fixture.items[0], interestReason: "x".repeat(2001) }],
    }).success,
  ).toBe(false);
});
it("replays idempotently, appends new appearances, and rejects conflicting batches atomically", async () => {
  const { ingest, service } = await setup();
  const input = ingestSchema.parse(fixture);
  const first = ingest(input);
  expect(first.createdItems).toBe(1);
  await service.recordLinkOpen(first.items[0].internalId);
  await service.resolveItem(first.items[0].internalId);
  await service.setPreference(first.items[0].internalId, "interested");
  const original = {
    emails: rows("emails"),
    items: rows("items"),
    events: rows("item_interactions"),
    preferences: db.prepare("SELECT * FROM reader_preferences").all(),
  };
  expect(ingest(input).createdItems).toBe(0);
  expect({
    emails: rows("emails"),
    items: rows("items"),
    events: rows("item_interactions"),
    preferences: db.prepare("SELECT * FROM reader_preferences").all(),
  }).toEqual(original);
  const append = {
    ...input,
    items: [
      { ...input.items[0], id: "new-2" },
      { ...input.items[0], title: "Changed" },
    ],
  };
  expect(() => ingest(append)).toThrow(/differs/);
  expect(rows("items")).toEqual(original.items);
  expect(() =>
    ingest({ ...input, message: { ...input.message, subject: "Changed" } }),
  ).toThrow(/differs/);
  expect(() =>
    ingest({ ...input, source: { ...input.source, label: "Different" } }),
  ).toThrow(/label/);
  expect(
    ingest({ ...input, items: [{ ...input.items[0], id: "new-2" }] })
      .createdItems,
  ).toBe(1);
  expect(rows("emails")[0]).toMatchObject({
    total_items: 2,
    resolved_items: 1,
    completion_state: "active",
  });
  expect(rows("item_interactions")).toHaveLength(3);
});
it("separates same sender/message/item IDs by source and accepts narrative cards without URLs", async () => {
  const { ingest } = await setup();
  ingest(ingestSchema.parse(fixture));
  ingest(
    ingestSchema.parse({
      ...fixture,
      source: { id: "tldr-ai", label: "TLDR AI" },
    }),
  );
  ingest(
    ingestSchema.parse({
      ...fixture,
      source: { id: "tia-reports", label: "Market Letter" },
      items: [
        {
          id: "narrative",
          title: "A market briefing",
          description: "A complete narrative issue",
        },
      ],
    }),
  );
  expect(rows("emails")).toHaveLength(3);
  expect(rows("items")).toHaveLength(3);
  expect(rows("item_interactions")).toHaveLength(0);
});
it("records opens/clicks/details and explicit preferences while preserving resolve semantics and undo", async () => {
  const { ingest, service } = await setup();
  const result = ingest(
    ingestSchema.parse({
      ...fixture,
      items: [...fixture.items, { ...fixture.items[0], id: "story-2" }],
    }),
  );
  const [one, two] = result.items.map((i) => i.internalId);
  await service.openItem(one);
  await service.recordDescriptionExpand(one);
  await service.resolveItem(one);
  await service.resolveItem(one);
  expect(rows("item_interactions").at(-1)).toMatchObject({
    action: "resolve",
    actor: "human",
    resolve_mode: "direct",
    opened_before_resolve: 0,
  });
  await service.recordLinkOpen(two);
  await service.resolveItem(two);
  await service.unresolveItem(two);
  await service.unresolveItem(two);
  await service.setPreference(two, "less_like_this");
  await service.setPreference(two, "less_like_this");
  await service.setPreference(two, "clear");
  const events = rows("item_interactions");
  expect(events).toHaveLength(8);
  expect(events[4]).toMatchObject({
    action: "resolve",
    resolve_mode: "after_open",
    opened_before_resolve: 1,
  });
  expect(rows("emails")[0]).toMatchObject({
    resolved_items: 1,
    completion_state: "active",
    gmail_sync_pending: 0,
  });
  const payload = await service.getInboxPayload();
  expect(payload.emails[0].items[1].preference).toBe("clear");
  expect(payload.emails[0].items[0].collections[0].tabId).toBe("tldr");
  await expect(service.resolveItem(999)).rejects.toThrow(/not found/);
  await expect(service.recordLinkOpen(999)).rejects.toThrow(/not found/);
  await expect(service.setPreference(999, "clear")).rejects.toThrow(
    /not found/,
  );
});
it("keeps explicit topics for other sources whose IDs happen to contain TLDR", async () => {
  const { ingest, service } = await setup();
  const collections = [
    {
      categoryId: "engineering",
      categoryLabel: "Engineering",
      tabId: "systems-code",
      tabLabel: "Systems & Code",
    },
  ];
  ingest(
    ingestSchema.parse({
      ...fixture,
      source: { id: "tldr-community", label: "Community" },
      items: [{ ...fixture.items[0], collections }],
    }),
  );
  const item = (await service.getInboxPayload()).emails[0].items[0];
  expect(item.collections).toEqual(collections);
  expect(item).not.toHaveProperty("aiFeatureStatus");
  expect(item).not.toHaveProperty("interestModel");
});
it("backs up WAL safely and adds schema without changing any old values, even before classifier columns existed", async () => {
  const { database } = await setup();
  db.exec(`INSERT INTO emails (id,provider,provider_message_id,source_family,source_variant,sender_name,sender_email,subject,snippet,received_at,created_at,updated_at) VALUES (42,'gmail','legacy-synthetic','tldr','TLDR AI','Synthetic','','Legacy issue','',123,124,125);
  INSERT INTO items (id,email_id,source_item_id,section,position,title,summary,item_kind,tracked_url,resolved_at,created_at,updated_at) VALUES (77,42,'original-id-with-title','Research',0,'Old title','Old description','editorial','https://example.com/legacy',130,126,131);
  INSERT INTO article_snapshots (url_key,source_url,final_url,status,title,content_html,content_text,updated_at) VALUES ('https://example.com/legacy','https://example.com/legacy','https://example.com/legacy','ready','Legacy snapshot','<p>Cached content</p>','Cached content',132);`);
  const { recordItemInteraction } = await import("@/lib/db/repository");
  recordItemInteraction(77, "resolve");
  // Recreate the older pre-classifier schema, with a legacy event that has no actor.
  db.exec(
    "DROP INDEX items_interest_status_idx; DROP INDEX items_ai_feature_status_idx; ALTER TABLE item_interactions DROP COLUMN actor;",
  );
  for (const c of [
    "interest_status",
    "interest_reason",
    "interest_model",
    "interest_prompt_version",
    "interest_classified_at",
    "ai_feature_status",
    "ai_feature_reason",
    "ai_feature_model",
    "ai_feature_prompt_version",
    "ai_feature_classified_at",
  ])
    db.exec(`ALTER TABLE items DROP COLUMN ${c}`);
  const original = fingerprint(db);
  const backup = path.join(dir, "backup.sqlite");
  await backupDatabase(path.join(dir, "synthetic.sqlite"), backup);
  expect(fs.statSync(backup).mode & 0o777).toBe(0o600);
  await expect(
    backupDatabase(path.join(dir, "synthetic.sqlite"), backup),
  ).rejects.toThrow();
  const baseline = new Database(backup, { readonly: true });
  try {
    database.migrateDatabase(db);
    expect(fingerprint(db, original)).toEqual(original);
    expect(verifyPreserved(baseline, db)).toHaveLength(original.length);
    database.migrateDatabase(db);
    expect(fingerprint(db, original)).toEqual(original);
    expect(rows("item_interactions")[0]).toMatchObject({
      item_id: 77,
      actor: "unknown",
    });
  } finally {
    baseline.close();
  }
});
it("explicitly maps legacy appearances without changing their IDs, descriptions, resolution, or timestamps", async () => {
  const { ingest } = await setup();
  db.exec(`INSERT INTO emails (id,provider,provider_message_id,source_family,source_variant,sender_name,sender_email,subject,snippet,received_at,created_at,updated_at) VALUES (42,'gmail','legacy-synthetic','tldr','TLDR','','','Old subject','',1,2,3);
  INSERT INTO items (id,email_id,source_item_id,section,position,title,summary,item_kind,tracked_url,resolved_at,created_at,updated_at) VALUES (77,42,'original-title-url-id','Research',0,'Original','Original description','editorial','https://example.com/story',4,2,5);`);
  const before = { emails: rows("emails"), items: rows("items") };
  const input = ingestSchema.parse({
    ...fixture,
    message: {
      ...fixture.message,
      origin: { provider: "gmail", messageId: "legacy-synthetic" },
    },
    items: [{ ...fixture.items[0], legacyItemId: 77 }],
  });
  expect(ingest(input).items[0].internalId).toBe(77);
  expect({ emails: rows("emails"), items: rows("items") }).toEqual(before);
  expect(ingest(input).createdItems).toBe(0);
  expect(() =>
    ingest({
      ...input,
      items: [{ ...input.items[0], id: "unmapped", legacyItemId: undefined }],
    }),
  ).toThrow(/legacyItemId/);
});
it("rejects unsafe URLs, malformed identifiers, unknown fields, duplicates, and oversized fields", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///etc/passwd",
    "http://127.1/x",
    "http://2130706433",
    "http://[::ffff:127.0.0.1]",
    "http://[::1]",
    "http://10.0.0.2",
    "http://169.254.169.254",
    "http://100.64.0.1",
    "http://localhost/a",
    "https://foo.local",
    "https://user:pass@example.com",
    "https://example.com:8443",
    "https://example.com/\\nhello",
  ]) {
    expect(safeExternalUrl(url), url).toBeNull();
    expect(
      ingestSchema.safeParse({
        ...fixture,
        items: [{ ...fixture.items[0], url }],
      }).success,
      url,
    ).toBe(false);
  }
  expect(safeExternalUrl("https://[2606:4700:4700::1111]/")).not.toBeNull();
  expect(
    ingestSchema.safeParse({
      ...fixture,
      items: [...fixture.items, ...fixture.items],
    }).success,
  ).toBe(false);
  expect(ingestSchema.safeParse({ ...fixture, extra: 1 }).success).toBe(false);
  expect(
    ingestSchema.safeParse({
      ...fixture,
      source: { id: "Bad source", label: "X" },
    }).success,
  ).toBe(false);
  expect(
    ingestSchema.safeParse({
      ...fixture,
      items: [{ ...fixture.items[0], title: "x".repeat(501) }],
    }).success,
  ).toBe(false);
});
it("enforces separate ingestion/feedback tokens, source allowlist, bounds, and cursor pagination", async () => {
  await setup();
  const { POST } = await import("@/app/api/v1/ingest/route");
  const { GET } = await import("@/app/api/v1/engagement/route");
  const req = (body: unknown, token = "synthetic-ingest-test-only") =>
    new Request("http://localhost/api/v1/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  expect((await POST(req(fixture, "wrong"))).status).toBe(401);
  expect(
    (await POST(req(fixture, "synthetic-feedback-test-only"))).status,
  ).toBe(403);
  expect(
    (
      await POST(
        req({ ...fixture, source: { id: "unknown", label: "Unknown" } }),
      )
    ).status,
  ).toBe(403);
  expect((await POST(req({ ...fixture, items: [] }))).status).toBe(400);
  expect((await POST(req(fixture))).status).toBe(201);
  expect((await POST(req(fixture))).status).toBe(200);
  expect(
    (
      await POST(
        req({ ...fixture, items: [{ ...fixture.items[0], title: "Changed" }] }),
      )
    ).status,
  ).toBe(409);
  const service = await import("@/lib/inbox/service");
  await service.recordLinkOpen(1);
  await service.resolveItem(1);
  const feed = (query = "") =>
    GET(
      new Request(`http://localhost/api/v1/engagement${query}`, {
        headers: { authorization: "Bearer synthetic-feedback-test-only" },
      }),
    );
  expect(
    (await GET(new Request("http://localhost/api/v1/engagement"))).status,
  ).toBe(401);
  expect((await feed("?after=-1")).status).toBe(400);
  const first = await (await feed("?limit=1")).json();
  expect(first.hasMore).toBe(true);
  expect(first.events[0]).toMatchObject({
    actor: "human",
    api_source_id: "tldr",
    api_item_id: "story-1",
  });
  const next = await (await feed(`?after=${first.nextCursor}`)).json();
  expect(next.events).toHaveLength(1);
  expect(next.hasMore).toBe(false);
  expect(
    (
      await POST(
        new Request("http://localhost/api/v1/ingest", {
          method: "POST",
          headers: {
            authorization: "Bearer synthetic-ingest-test-only",
            "content-type": "application/json",
          },
          body: "x".repeat(512001),
        }),
      )
    ).status,
  ).toBe(400);
  delete process.env.MAIL_DIGESTER_INGEST_TOKEN;
  expect((await POST(req(fixture))).status).toBe(200);
});
it("returns an empty private library without side effects and handles invalid JSON envelopes", async () => {
  const { service } = await setup();
  expect((await service.getInboxPayload()).emails).toEqual([]);
  const { readBoundedJson } = await import("@/lib/api/security");
  await expect(
    readBoundedJson(new Request("http://localhost", { method: "POST" })),
  ).rejects.toThrow(/application\/json/);
  await expect(
    readBoundedJson(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    ),
  ).rejects.toThrow(/Missing body/);
});
it("does not count an agent click as a human read before Done", async () => {
  const { ingest, service } = await setup();
  const id = ingest(ingestSchema.parse(fixture)).items[0].internalId;
  await service.recordLinkOpen(id, {}, "agent");
  await service.resolveItem(id);
  expect(rows("item_interactions").at(-1)).toMatchObject({
    actor: "human",
    resolve_mode: "direct",
    opened_before_resolve: 0,
  });
  await service.unresolveItem(id);
  await service.recordLinkOpen(id);
  await service.resolveItem(id);
  expect(rows("item_interactions").at(-1)).toMatchObject({
    actor: "human",
    resolve_mode: "after_open",
    opened_before_resolve: 1,
  });
});
it("keeps input defaults optional in the published JSON Schema", () => {
  expect(inputSchema.properties.message.required).toEqual([
    "id",
    "subject",
    "receivedAt",
  ]);
  expect(inputSchema.properties.items.items.required).toEqual(["id", "title"]);
  expect(inputSchema.properties.source.properties.id.allOf).toContainEqual({
    pattern: "^[a-z0-9][a-z0-9_-]*$",
  });
});
it("keeps latest explicit preferences and separate appearances in both recommendation tools", async () => {
  const { ingest, service } = await setup();
  const result = ingest(
    ingestSchema.parse({
      ...fixture,
      items: [
        fixture.items[0],
        { ...fixture.items[0], id: "another-appearance" },
      ],
    }),
  );
  const [one, two] = result.items.map((item) => item.internalId);
  await service.resolveItem(one);
  await service.unresolveItem(one);
  await service.resolveItem(one);
  await service.resolveItem(two);
  const run = (script: string) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          `analytics/${script}.mjs`,
          "--db",
          path.join(dir, "synthetic.sqlite"),
          "--format",
          "json",
        ],
        { encoding: "utf8" },
      ),
    );
  expect(run("analyze-interests").candidateRules).toEqual([]);
  expect(
    run("llm-context").items.map(
      (item: { interestScore: number }) => item.interestScore,
    ),
  ).toEqual([0, 0]);
  for (const signal of [
    "interested",
    "clear",
    "interested",
    "less_like_this",
    "clear",
  ] as const) {
    await service.setPreference(one, signal);
  }
  await service.setPreference(two, "interested");
  const analysis = run("analyze-interests");
  expect(analysis.uniqueItemCount).toBe(2);
  expect(analysis.topInterestingItems).toHaveLength(1);
  expect(analysis.topInterestingItems[0]).toMatchObject({
    score: 4,
    preference: "interested",
  });
  expect(analysis.likelySkippedItems).toEqual([]);
  const context = run("llm-context");
  expect(context.items).toHaveLength(2);
  expect(
    context.items.find((item: { itemId: number }) => item.itemId === one),
  ).toMatchObject({ interestScore: 0, preference: "clear" });
  expect(
    context.items.find((item: { itemId: number }) => item.itemId === two),
  ).toMatchObject({ interestScore: 4, preference: "interested" });
  expect(rows("item_interactions")).toHaveLength(10);
  await service.setPreference(one, "less_like_this");
  await service.setPreference(two, "less_like_this");
  const negative = run("analyze-interests");
  expect(negative.likelySkippedItems).toHaveLength(2);
  expect(
    negative.candidateRules.some(
      (rule: { type: string }) => rule.type === "deprioritize",
    ),
  ).toBe(true);
});
it("rejects private/reserved literal address variants and preserves safe public destinations", () => {
  for (const url of [
    "https://[fc00::1]",
    "https://[2001:db8::1]",
    "https://[2002:7f00::1]",
    "http://0.0.0.0",
    "http://224.0.0.1",
    "http://192.168.1.1",
    "http://192.0.0.1",
    "http://172.16.0.1",
    "http://198.18.0.1",
    "http://singlelabel/",
    "http://foo.internal",
    "http://foo.onion",
    "http://foo.test",
    "http://example.com/path\\backslash",
  ])
    expect(safeExternalUrl(url), url).toBeNull();
  expect(safeExternalUrl("http://8.8.8.8/")).toBe("http://8.8.8.8/");
  expect(safeExternalUrl("https://example.com./")).not.toBeNull();
});

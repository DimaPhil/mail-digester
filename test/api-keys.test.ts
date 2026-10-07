import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";

let dir: string;
let db: Database.Database;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mail-keys-"));
  vi.stubEnv("MAIL_DIGESTER_DB_PATH", path.join(dir, "test.sqlite"));
  vi.stubEnv("MAIL_DIGESTER_INGEST_TOKEN", "legacy-ingest-synthetic");
  vi.stubEnv("MAIL_DIGESTER_FEEDBACK_TOKEN", "legacy-feedback-synthetic");
  delete globalThis.__mailDigesterDb;
  vi.resetModules();
  db = (await import("@/lib/db")).getSqlite();
});
afterEach(() => {
  db?.close();
  delete globalThis.__mailDigesterDb;
  fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
const request = (token?: string) =>
  new Request("http://localhost/api/inbox", {
    headers: token === undefined ? {} : { authorization: "Bearer " + token },
  });
it("imports legacy tokens once, persists revocation, and keeps secrets out of storage/readback", async () => {
  const keys = await import("@/lib/api/keys");
  const initial = keys.listApiKeys();
  expect(initial).toHaveLength(2);
  expect(initial.find((k) => k.scopes.includes("ingest"))).toMatchObject({
    lastUsedAt: null,
  });
  const old = keys.authenticateApiKey(
    request("legacy-ingest-synthetic"),
    "ingest",
  );
  expect("key" in old && old.key.lastUsedAt).toBeGreaterThan(0);
  expect(
    keys.authenticateApiKey(request("legacy-ingest-synthetic"), "feedback"),
  ).toMatchObject({ denied: { status: 403 } });
  keys.revokeApiKey(initial.find((k) => k.scopes.includes("ingest"))!.id);
  keys.revokeApiKey(initial.find((k) => k.scopes.includes("ingest"))!.id);
  // Reopen modules/database as on restart, with the old environment still configured.
  db.close();
  delete globalThis.__mailDigesterDb;
  vi.resetModules();
  db = (await import("@/lib/db")).getSqlite();
  const restarted = await import("@/lib/api/keys");
  expect(restarted.listApiKeys()).toHaveLength(2);
  expect(
    restarted.authenticateApiKey(request("legacy-ingest-synthetic"), "ingest"),
  ).toMatchObject({ denied: { status: 401 } });
  const created = restarted.createApiKey("Agent", ["inbox", "items"]);
  expect(created.key).toMatch(/^mdk_[\w-]{43}$/);
  expect(created.apiKey).toMatchObject({
    name: "Agent",
    scopes: ["inbox", "items"],
    revokedAt: null,
    rotatedFrom: null,
  });
  expect(
    JSON.stringify(db.prepare("SELECT * FROM api_keys").all()),
  ).not.toContain(created.key);
  expect(JSON.stringify(restarted.listApiKeys())).not.toContain(created.key);
  expect(
    restarted.authenticateApiKey(request(created.key), "inbox"),
  ).toMatchObject({ key: { id: created.apiKey.id } });
  expect(
    restarted.authenticateApiKey(request(created.key), "admin"),
  ).toMatchObject({ denied: { status: 403 } });
  const rotated = restarted.rotateApiKey(created.apiKey.id);
  expect(rotated.apiKey).toMatchObject({
    rotatedFrom: created.apiKey.id,
    scopes: created.apiKey.scopes,
    name: "Agent",
  });
  expect(restarted.authenticateApiKey(request(created.key))).toMatchObject({
    denied: { status: 401 },
  });
  expect(restarted.authenticateApiKey(request(rotated.key))).toMatchObject({
    key: { id: rotated.apiKey.id },
  });
  expect(() => restarted.rotateApiKey(created.apiKey.id)).toThrow(
    /Active API key/,
  );
  expect(() => restarted.revokeApiKey(99999)).toThrow(/not found/);
  expect(restarted.authenticateApiKey(request())).toMatchObject({
    denied: { status: 401 },
  });
  expect(restarted.authenticateApiKey(request("short"))).toMatchObject({
    denied: { status: 401 },
  });
  expect(
    restarted.authenticateApiKey(request("unknown-token-long-enough")),
  ).toMatchObject({ denied: { status: 401 } });
});
it("fails closed on invalid legacy configuration without committing partial bootstrap", async () => {
  const keys = await import("@/lib/api/keys");
  for (const [ingest, feedback] of [
    ["short", "valid-feedback-synthetic"],
    ["valid-ingest-synthetic", "short"],
    ["same-synthetic-secret", "same-synthetic-secret"],
  ]) {
    vi.stubEnv("MAIL_DIGESTER_INGEST_TOKEN", ingest);
    vi.stubEnv("MAIL_DIGESTER_FEEDBACK_TOKEN", feedback);
    expect(
      keys.authenticateApiKey(request("same-synthetic-secret")),
    ).toMatchObject({ denied: { status: 503 } });
    expect(db.prepare("SELECT COUNT(*) AS n FROM api_keys").get()).toEqual({
      n: 0,
    });
  }
  vi.stubEnv("MAIL_DIGESTER_INGEST_TOKEN", "");
  vi.stubEnv("MAIL_DIGESTER_FEEDBACK_TOKEN", "");
  expect(keys.listApiKeys()).toEqual([]);
  expect(keys.createApiKey("First", ["admin"]).apiKey.id).toBe(1);
});
it("validates shared requests, enforces explicit Bearer scope, and preserves trusted browser access", async () => {
  const { apiOperation } = await import("@/lib/api/operation");
  const { createApiKey } = await import("@/lib/api/keys");
  const write = vi.fn(() => Response.json({ ok: true }));
  const incompatible = await apiOperation(
    "keys-create",
    write,
  )(
    new Request("http://localhost", {
      method: "POST",
      headers: { "x-mail-digester-contract": "old-client" },
    }),
  );
  expect(incompatible.status).toBe(409);
  expect(await incompatible.json()).toMatchObject({
    code: "API_CONTRACT_MISMATCH",
  });
  expect(write).not.toHaveBeenCalled();
  expect(() =>
    apiOperation("forgot-to-register", () => Response.json({})),
  ).toThrow(/Unregistered/);
  const inbox = apiOperation("inbox", (_r, c) =>
    Response.json({ actor: c.key ? "agent" : "human" }),
  );
  expect(await (await inbox(request())).json()).toEqual({ actor: "human" });
  expect(
    await (
      await inbox(
        new Request("http://localhost", {
          headers: { authorization: "Basic old-reader-login" },
        }),
      )
    ).json(),
  ).toEqual({ actor: "human" });
  expect((await inbox(request("not-a-key-long-enough"))).status).toBe(401);
  const key = createApiKey("Read only", ["inbox"]);
  const response = await inbox(request(key.key));
  expect(await response.json()).toEqual({ actor: "agent" });
  expect(response.headers.get("X-Mail-Digester-Contract")).toMatch(
    /^[a-f0-9]{64}$/,
  );
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const create = (await import("@/app/api/admin/keys/route")).POST;
  const post = (body: unknown, token?: string) =>
    create(
      new Request("http://localhost/api/admin/keys", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: "Bearer " + token } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  expect((await post({ name: "Not admin" }, key.key)).status).toBe(403);
  for (const body of [
    { name: " " },
    { name: "A", scopes: [] },
    { name: "A", scopes: ["admin", "admin"] },
    { name: "A", scopes: ["unknown"] },
    { name: "A", secret: "custom" },
  ])
    expect((await post(body)).status).toBe(400);
  const created = await post({ name: "  Default  " });
  expect(created.status).toBe(201);
  expect((await created.json()).apiKey).toMatchObject({
    name: "Default",
    scopes: ["inbox", "items", "ingest", "feedback"],
  });
  const preference = apiOperation("item-preference", async (_r, c) =>
    Response.json({ body: c.body, params: await c.params }),
  );
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  const prefRequest = (body: string) =>
    new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  for (const id of ["NaN", "0", "-1", "99999999999999999999"])
    expect(
      (await preference(prefRequest('{"signal":"clear"}'), context(id))).status,
    ).toBe(400);
  expect(
    (await preference(prefRequest('{"signal":"invented"}'), context("1")))
      .status,
  ).toBe(400);
  expect(
    (await preference(prefRequest("invalid JSON"), context("1"))).status,
  ).toBe(400);
  expect(
    (
      await preference(
        new Request("http://localhost", { method: "POST" }),
        context("1"),
      )
    ).status,
  ).toBe(400);
  expect(
    await (
      await preference(prefRequest('{"signal":"clear"}'), context("1"))
    ).json(),
  ).toEqual({ body: { signal: "clear" }, params: { id: "1" } });
  const open = apiOperation("item-open", (_r, c) => Response.json(c.body));
  expect(
    await (
      await open(
        new Request("http://localhost", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "",
        }),
        context("1"),
      )
    ).json(),
  ).toEqual({});
  expect(
    (await open(prefRequest('{"unexpected":true}'), context("1"))).status,
  ).toBe(400);
  expect(
    await (
      await open(
        new Request("http://localhost", { method: "POST" }),
        context("1"),
      )
    ).json(),
  ).toEqual({});
  const engagement = apiOperation("engagement", (_r, c) =>
    Response.json(c.query),
  );
  const query = (qs: string) =>
    engagement(
      new Request("http://localhost" + qs, {
        headers: { authorization: "Bearer legacy-feedback-synthetic" },
      }),
    );
  expect(await (await query("")).json()).toEqual({ after: 0, limit: 100 });
  expect(await (await query("?after=12&limit=5")).json()).toEqual({
    after: 12,
    limit: 5,
  });
  for (const qs of ["?after=-1", "?limit=501", "?limit=0", "?surprise=1"])
    expect((await query(qs)).status).toBe(400);
});

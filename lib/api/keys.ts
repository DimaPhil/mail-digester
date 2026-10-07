import { createHash, randomBytes } from "node:crypto";
import { getSqlite } from "@/lib/db";
import type { ApiKeyScope } from "@/lib/api/key-scopes";

export type ApiKeyInfo = {
  id: number;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  rotatedFrom: number | null;
};
type KeyRow = {
  id: number;
  name: string;
  token_hash: string;
  prefix: string;
  scopes_json: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
  rotated_from: number | null;
};
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
function info(row: KeyRow): ApiKeyInfo {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: JSON.parse(row.scopes_json),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    rotatedFrom: row.rotated_from,
  };
}
function insert(
  name: string,
  scopes: ApiKeyScope[],
  token: string,
  rotatedFrom: number | null = null,
) {
  const db = getSqlite();
  const result = db
    .prepare(
      "INSERT INTO api_keys (name, token_hash, prefix, scopes_json, created_at, rotated_from) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      name,
      hash(token),
      token.slice(0, 12),
      JSON.stringify(scopes),
      Date.now(),
      rotatedFrom,
    );
  return info(
    db
      .prepare("SELECT * FROM api_keys WHERE id = ?")
      .get(result.lastInsertRowid) as KeyRow,
  );
}
function bootstrap() {
  const db = getSqlite();
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM api_key_bootstrap WHERE id = 1").get())
      return;
    const ingest = process.env.MAIL_DIGESTER_INGEST_TOKEN;
    const feedback = process.env.MAIL_DIGESTER_FEEDBACK_TOKEN;
    if (
      (ingest && ingest.length < 16) ||
      (feedback && feedback.length < 16) ||
      (ingest && ingest === feedback)
    )
      throw new Error(
        "Legacy API tokens must be distinct and at least 16 characters",
      );
    for (const [name, token, scope] of [
      ["Imported ingestion token", ingest, "ingest"],
      ["Imported feedback token", feedback, "feedback"],
    ] as const) {
      if (
        token &&
        !db
          .prepare("SELECT 1 FROM api_keys WHERE token_hash = ?")
          .get(hash(token))
      )
        insert(name, [scope], token);
    }
    db.prepare("INSERT INTO api_key_bootstrap VALUES (1)").run();
  }).immediate();
}
export function listApiKeys() {
  bootstrap();
  return (
    getSqlite()
      .prepare("SELECT * FROM api_keys ORDER BY created_at DESC, id DESC")
      .all() as KeyRow[]
  ).map(info);
}
export function createApiKey(name: string, scopes: ApiKeyScope[]) {
  bootstrap();
  const key = "mdk_" + randomBytes(32).toString("base64url");
  return { key, apiKey: insert(name, scopes, key) };
}
export function revokeApiKey(id: number) {
  bootstrap();
  const db = getSqlite();
  if (!db.prepare("SELECT 1 FROM api_keys WHERE id = ?").get(id))
    throw new Error("API key not found");
  db.prepare(
    "UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
  ).run(Date.now(), id);
  return { ok: true };
}
export function rotateApiKey(id: number) {
  bootstrap();
  const db = getSqlite();
  return db
    .transaction(() => {
      const row = db
        .prepare("SELECT * FROM api_keys WHERE id = ? AND revoked_at IS NULL")
        .get(id) as KeyRow | undefined;
      if (!row) throw new Error("Active API key not found");
      const key = "mdk_" + randomBytes(32).toString("base64url");
      const apiKey = insert(row.name, JSON.parse(row.scopes_json), key, id);
      revokeApiKey(id);
      return { key, apiKey };
    })
    .immediate();
}
export function authenticateApiKey(
  request: Request,
  scope?: ApiKeyScope,
): { key: ApiKeyInfo } | { denied: Response } {
  try {
    bootstrap();
  } catch {
    return {
      denied: Response.json(
        {
          error:
            "API key initialization failed; check legacy token configuration",
        },
        { status: 503 },
      ),
    };
  }
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token || token.length < 16)
    return {
      denied: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  const db = getSqlite();
  const row = db
    .prepare(
      "SELECT * FROM api_keys WHERE token_hash = ? AND revoked_at IS NULL",
    )
    .get(hash(token)) as KeyRow | undefined;
  if (!row)
    return {
      denied: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  const key = info(row);
  if (scope && !key.scopes.includes(scope))
    return {
      denied: Response.json(
        { error: `API key requires ${scope} permission` },
        { status: 403 },
      ),
    };
  key.lastUsedAt = Date.now();
  db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(
    key.lastUsedAt,
    key.id,
  );
  return { key };
}

import { timingSafeEqual } from "node:crypto";

export function matchesSecret(actual: string, expected: string | undefined) {
  if (!expected || expected.length < 16) return false;
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function authorizeBearer(request: Request, role: "INGEST" | "FEEDBACK") {
  const token = process.env[`MAIL_DIGESTER_${role}_TOKEN`];
  const otherToken =
    process.env[
      `MAIL_DIGESTER_${role === "INGEST" ? "FEEDBACK" : "INGEST"}_TOKEN`
    ];
  if (token && token === otherToken)
    return Response.json(
      { error: "API roles require distinct secrets" },
      { status: 503 },
    );
  if (!token || token.length < 16)
    return Response.json(
      { error: "API authorization is not configured" },
      { status: 503 },
    );
  if (
    !matchesSecret(
      request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "",
      token,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function readBoundedJson(request: Request, maxBytes = 512_000) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new Error("Expected application/json");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("Body too large");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

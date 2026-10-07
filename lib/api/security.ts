export async function readBoundedJson(
  request: Request,
  maxBytes = 512_000,
  allowEmpty = false,
) {
  const json = request.headers
    .get("content-type")
    ?.startsWith("application/json");
  if (!json && !allowEmpty) throw new Error("Expected application/json");
  const reader = request.body?.getReader();
  if (!reader) {
    if (allowEmpty) return undefined;
    throw new Error("Missing body");
  }
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
  if (!size && allowEmpty) return undefined;
  if (!json) throw new Error("Expected application/json");
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

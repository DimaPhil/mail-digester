export const dynamic = "force-dynamic";
import { setPreference } from "@/lib/inbox/service";
import { readBoundedJson } from "@/lib/api/security";
import { z } from "zod";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const raw = (await context.params).id,
    id = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(id) || id < 1)
    return Response.json({ error: "Invalid item ID" }, { status: 400 });
  try {
    const body = z
      .object({ signal: z.enum(["interested", "less_like_this", "clear"]) })
      .strict()
      .parse(await readBoundedJson(request, 2048));
    const result = await setPreference(id, body.signal);
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json(
      { error: "Item not found or invalid request" },
      { status: 400 },
    );
  }
}

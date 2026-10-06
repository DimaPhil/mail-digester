export const dynamic = "force-dynamic";
import { authorizeBearer, readBoundedJson } from "@/lib/api/security";
import { ingest, ingestSchema, IngestConflict } from "@/lib/api/ingest";
export async function POST(request: Request) {
  const denied = authorizeBearer(request, "INGEST");
  if (denied) return denied;
  try {
    const body = ingestSchema.safeParse(await readBoundedJson(request));
    if (!body.success)
      return Response.json(
        {
          error: "Invalid input",
          issues: body.error.issues.map((i) => ({
            path: i.path,
            message: i.message,
          })),
        },
        { status: 400 },
      );
    const allowed = (
      process.env.MAIL_DIGESTER_ALLOWED_SOURCES ?? "tldr,tldr-ai"
    )
      .split(",")
      .map((s) => s.trim());
    if (!allowed.includes(body.data.source.id))
      return Response.json({ error: "Source is not enabled" }, { status: 403 });
    const result = ingest(body.data);
    return Response.json(result, {
      status: result.createdItems ? 201 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof IngestConflict
            ? error.message
            : "Invalid request or ingestion failed",
      },
      { status: error instanceof IngestConflict ? 409 : 400 },
    );
  }
}

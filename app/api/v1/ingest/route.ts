export const dynamic = "force-dynamic";
import { apiOperation } from "@/lib/api/operation";
import { ingest, type IngestInput, IngestConflict } from "@/lib/api/ingest";
export const POST = apiOperation("ingest", async (_request, context) => {
  try {
    const body = context.body as IngestInput;
    const allowed = (
      process.env.MAIL_DIGESTER_ALLOWED_SOURCES ?? "tldr,tldr-ai"
    )
      .split(",")
      .map((s) => s.trim());
    if (!allowed.includes(body.source.id))
      return Response.json({ error: "Source is not enabled" }, { status: 403 });
    const result = ingest(body);
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
});

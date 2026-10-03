export function POST() {
  return Response.json(
    { error: "Retired: use structured ingestion at /api/v1/ingest" },
    { status: 410 },
  );
}
export const GET = POST;
export const PATCH = POST;

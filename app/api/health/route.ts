export const dynamic = "force-dynamic";
import { getSqlite } from "@/lib/db";
import { apiOperation } from "@/lib/api/operation";
export const GET = apiOperation("health", () => {
  try {
    getSqlite().prepare("SELECT 1").get();
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
});

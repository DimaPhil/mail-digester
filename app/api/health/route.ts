export const dynamic = "force-dynamic";
import { getSqlite } from "@/lib/db";
export function GET() {
  try {
    getSqlite().prepare("SELECT 1").get();
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}

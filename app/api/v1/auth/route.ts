export const dynamic = "force-dynamic";
import { apiOperation } from "@/lib/api/operation";
export const GET = apiOperation("auth", (_request, context) =>
  Response.json({ apiKey: context.key }),
);

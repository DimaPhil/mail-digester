export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getInboxPayload } from "@/lib/inbox/service";
import { apiOperation } from "@/lib/api/operation";

export const GET = apiOperation("inbox", async () => {
  const payload = await getInboxPayload();
  return NextResponse.json(payload);
});

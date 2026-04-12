export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getInboxPayload } from "@/lib/inbox/service";

export async function GET() {
  const payload = await getInboxPayload();
  return NextResponse.json(payload);
}

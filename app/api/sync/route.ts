export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getInboxPayload, syncInbox } from "@/lib/inbox/service";

export async function POST() {
  try {
    await syncInbox();
    return NextResponse.json(await getInboxPayload());
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Sync failed",
        ...(await getInboxPayload()),
      },
      { status: 500 },
    );
  }
}

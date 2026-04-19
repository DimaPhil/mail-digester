export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getInboxPayload, syncInbox } from "@/lib/inbox/service";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      forceFullResync?: boolean;
    } | null;
    await syncInbox(undefined, {
      forceFullResync: body?.forceFullResync === true,
    });
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

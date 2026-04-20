export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import type { ItemInteractionMetadata } from "@/lib/db/repository";
import { resolveNonInterestingItems } from "@/lib/inbox/service";

async function readBody(request: Request) {
  try {
    const body = (await request.json()) as {
      keepRecentDays?: number;
      excludeAiListItems?: boolean;
      metadata?: ItemInteractionMetadata;
    };

    return {
      keepRecentDays: Number(body.keepRecentDays ?? 0),
      excludeAiListItems: body.excludeAiListItems === true,
      metadata: body.metadata ?? {},
    };
  } catch {
    return {
      keepRecentDays: 0,
      excludeAiListItems: false,
      metadata: {} satisfies ItemInteractionMetadata,
    };
  }
}

export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    return NextResponse.json(
      await resolveNonInterestingItems(
        body.keepRecentDays,
        undefined,
        {
          excludeAiListItems: body.excludeAiListItems,
        },
        {
          ...body.metadata,
          userAgent: request.headers.get("user-agent"),
          referrer: request.headers.get("referer"),
        },
      ),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to bulk resolve not-interesting links",
      },
      { status: 400 },
    );
  }
}

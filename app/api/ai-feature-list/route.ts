export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { buildAiFeatureList, getInboxPayload } from "@/lib/inbox/service";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      includeResolvedItems?: boolean;
    } | null;

    return NextResponse.json(
      await buildAiFeatureList(undefined, {
        includeResolvedItems: body?.includeResolvedItems === true,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to build AI feature list",
        ...(await getInboxPayload()),
      },
      { status: 400 },
    );
  }
}

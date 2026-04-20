export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import {
  getInboxPayload,
  updateAiFeaturePrompt,
  updateInterestPrompt,
} from "@/lib/inbox/service";

export async function GET() {
  return NextResponse.json(await getInboxPayload());
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      interestPrompt?: string | null;
      aiFeaturePrompt?: string | null;
    };
    if ("interestPrompt" in body) {
      return NextResponse.json(
        await updateInterestPrompt(body.interestPrompt ?? null),
      );
    }

    if ("aiFeaturePrompt" in body) {
      return NextResponse.json(
        await updateAiFeaturePrompt(body.aiFeaturePrompt ?? null),
      );
    }

    throw new Error("No supported config field was provided.");
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update config",
        ...(await getInboxPayload()),
      },
      { status: 400 },
    );
  }
}

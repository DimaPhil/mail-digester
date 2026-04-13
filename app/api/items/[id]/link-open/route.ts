export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import type { ItemInteractionMetadata } from "@/lib/db/repository";
import { recordLinkOpen } from "@/lib/inbox/service";

type Params = {
  params: Promise<{
    id: string;
  }>;
};

async function readMetadata(request: Request) {
  try {
    const body = (await request.json()) as {
      metadata?: ItemInteractionMetadata;
    };
    return body.metadata ?? {};
  } catch {
    return {};
  }
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const result = await recordLinkOpen(Number(id), {
    ...(await readMetadata(request)),
    userAgent: request.headers.get("user-agent"),
    referrer: request.headers.get("referer"),
  });
  return NextResponse.json(result);
}

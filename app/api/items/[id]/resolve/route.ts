export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { resolveItem } from "@/lib/inbox/service";

type Params = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(_: Request, { params }: Params) {
  const { id } = await params;
  const emails = await resolveItem(Number(id));
  return NextResponse.json({ emails });
}

export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { unresolveItem } from "@/lib/inbox/service";

type Params = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(_: Request, { params }: Params) {
  const { id } = await params;
  const emails = await unresolveItem(Number(id));
  return NextResponse.json({ emails });
}

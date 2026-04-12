export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { openItem } from "@/lib/inbox/service";

type Params = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(_: Request, { params }: Params) {
  const { id } = await params;
  const result = await openItem(Number(id));
  return NextResponse.json(result);
}

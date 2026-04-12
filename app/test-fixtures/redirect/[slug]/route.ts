import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const baseUrl = new URL(request.url).origin;
  return NextResponse.redirect(`${baseUrl}/test-fixtures/article/${slug}`, {
    status: 307,
  });
}

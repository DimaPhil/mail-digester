import { NextResponse } from "next/server";
import { getFixtureArticleHtml } from "@/lib/content/fixtures";

export async function GET(
  _: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const html = getFixtureArticleHtml(slug);

  if (!html) {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/api/health" || pathname.startsWith("/api/v1/"))
    return NextResponse.next();
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin");
    // Next may construct nextUrl with an internal localhost hostname.
    // Host is the browser's destination; an HTTPS proxy should set PUBLIC_ORIGIN.
    const expectedOrigin =
      process.env.MAIL_DIGESTER_PUBLIC_ORIGIN ||
      `${request.nextUrl.protocol}//${request.headers.get("host")}`;
    if (
      (origin && origin !== expectedOrigin) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    ) {
      return NextResponse.json(
        { error: "Cross-origin mutation rejected" },
        { status: 403 },
      );
    }
  }
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

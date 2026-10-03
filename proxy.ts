import { NextRequest, NextResponse } from "next/server";
import { matchesSecret } from "@/lib/api/security";

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/api/health" || pathname.startsWith("/api/v1/"))
    return NextResponse.next();
  const username = process.env.MAIL_DIGESTER_READER_USERNAME;
  const password = process.env.MAIL_DIGESTER_READER_PASSWORD;
  if (!username || !password || password.length < 16) {
    return new NextResponse("Reader authentication is not configured.", {
      status: 503,
    });
  }
  let credential = "";
  try {
    const header = request.headers.get("authorization") ?? "";
    if (header.startsWith("Basic "))
      credential = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    /* Invalid credentials fail closed. */
  }
  if (!matchesSecret(credential, `${username}:${password}`)) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Mail Digester", charset="UTF-8"',
      },
    });
  }
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

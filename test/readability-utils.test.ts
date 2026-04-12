import {
  extractReadableArticleFromHtml,
  fetchReadableSnapshot,
} from "@/lib/content/readability";
import { assertNever, cleanText, cn, formatRelativeDate } from "@/lib/utils";

describe("Readable article extraction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts and sanitizes readable content", () => {
    const result = extractReadableArticleFromHtml({
      sourceUrl: "https://source.example/story",
      finalUrl: "https://source.example/story",
      html: `
        <html>
          <head><title>Source story</title></head>
          <body>
            <article>
              <h1>Source story</h1>
              <p>Paragraph one.</p>
              <p><a href="https://example.com">Reference</a></p>
              <script>alert("x")</script>
            </article>
          </body>
        </html>
      `,
    });

    expect(result.title).toBe("Source story");
    expect(result.contentHtml).toContain("Paragraph one.");
    expect(result.contentHtml).not.toContain("<script");
  });

  it("throws when there is no readable content", () => {
    expect(() =>
      extractReadableArticleFromHtml({
        sourceUrl: "https://source.example/story",
        finalUrl: "https://source.example/story",
        html: "<html><body></body></html>",
      }),
    ).toThrow(/Could not extract readable article content/i);
  });

  it("rejects non-ok fetch responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 })),
    );
    await expect(
      fetchReadableSnapshot("https://source.example/story"),
    ).rejects.toThrow(/503/);
  });
});

describe("Utility helpers", () => {
  it("formats relative time across minute, hour, and day ranges", () => {
    const now = Date.now();
    expect(formatRelativeDate(now - 2 * 60 * 1000)).toMatch(/minute/i);
    expect(formatRelativeDate(now - 2 * 60 * 60 * 1000)).toMatch(/hour/i);
    expect(formatRelativeDate(now - 3 * 24 * 60 * 60 * 1000)).toMatch(/day/i);
  });

  it("covers text and class helpers and assertNever", () => {
    expect(cleanText("  hello   world  ")).toBe("hello world");
    expect(cn("alpha", false && "beta", "gamma")).toBe("alpha gamma");
    expect(() => assertNever("unexpected" as never)).toThrow(
      /Unexpected value/,
    );
  });
});

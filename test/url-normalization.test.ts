import { canonicalizeUrl } from "@/lib/content/url";

describe("URL normalization", () => {
  it("canonicalizes direct URLs consistently", () => {
    expect(
      canonicalizeUrl("https://Example.com/story/?utm_source=tldr#top"),
    ).toBe("https://example.com/story");
  });

  it("preserves content query parameters while removing tracking", () => {
    expect(
      canonicalizeUrl(
        "https://Example.com:443/story/?utm_source=tldr&fbclid=sample&id=42#top",
      ),
    ).toBe("https://example.com/story?id=42");
    expect(canonicalizeUrl("http://Example.com:80/?mc_id=sample")).toBe(
      "http://example.com/",
    );
  });
});

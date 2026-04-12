import { canonicalizeUrl, normalizeTrackedUrl } from "@/lib/content/url";

describe("URL normalization", () => {
  it("unwraps TLDR tracking links and strips tracking params", () => {
    const result = normalizeTrackedUrl(
      "https://tracking.tldrnewsletter.com/CL0/https:%2F%2Fexample.com%2Fstory%3Futm_source%3Dtldr%26utm_medium%3Demail%26id%3D42/1/token",
    );

    expect(result.canonicalUrl).toBe("https://example.com/story?id=42");
    expect(result.needsNetworkResolution).toBe(false);
  });

  it("keeps short links marked for network resolution", () => {
    const result = normalizeTrackedUrl(
      "https://tracking.tldrnewsletter.com/CL0/https:%2F%2Flinks.tldrnewsletter.com%2Fabc123/1/token",
    );

    expect(result.canonicalUrl).toBe("https://links.tldrnewsletter.com/abc123");
    expect(result.needsNetworkResolution).toBe(true);
  });

  it("canonicalizes direct URLs consistently", () => {
    expect(
      canonicalizeUrl("https://Example.com/story/?utm_source=tldr#top"),
    ).toBe("https://example.com/story");
  });

  it("handles empty and malformed URLs without throwing", () => {
    expect(normalizeTrackedUrl("")).toEqual({
      trackedUrl: "",
      canonicalUrl: null,
      needsNetworkResolution: false,
    });

    expect(normalizeTrackedUrl("not a url")).toEqual({
      trackedUrl: "not a url",
      canonicalUrl: null,
      needsNetworkResolution: false,
    });
  });
});

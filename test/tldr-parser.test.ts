import { pickDigestSource } from "@/lib/digest";
import {
  parseSender,
  providerMessageFromFixture,
  TldrDigestSource,
} from "@/lib/digest/tldr";
import { FixtureMailProvider } from "@/lib/mail/providers/fixture";

describe("TldrDigestSource", () => {
  it("parses TLDR AI issues into ordered reading items", async () => {
    const provider = new FixtureMailProvider();
    const message = await provider.getMessage("fixture-ai-001");
    const source = new TldrDigestSource();
    const parsed = source.parse(message);

    expect(parsed.sourceVariant).toBe("TLDR AI");
    expect(parsed.items).toHaveLength(3);
    expect(parsed.items[0]).toMatchObject({
      title: "OpenAI sharpens its enterprise roadmap (3 minute read)",
      section: "HEADLINES & LAUNCHES",
      itemKind: "editorial",
    });
    expect(parsed.items[1].canonicalUrl).toContain(
      "/test-fixtures/redirect/claude-control-panels",
    );
    expect(parsed.items[2].section).toBe("DEEP DIVES & ANALYSIS");
  });

  it("filters utility links but keeps sponsor and discussion items", async () => {
    const provider = new FixtureMailProvider();
    const message = await provider.getMessage("fixture-main-001");
    const source = pickDigestSource(message);

    expect(source).not.toBeNull();

    const parsed = source!.parse(message);
    expect(parsed.items).toHaveLength(3);
    expect(parsed.items.some((item) => item.itemKind === "sponsor")).toBe(true);
    expect(parsed.items.some((item) => item.itemKind === "discussion")).toBe(
      true,
    );
    expect(parsed.items.some((item) => item.title === "View Online")).toBe(
      false,
    );
  });

  it("ignores inline summary links and keeps only the main story anchors", () => {
    const source = new TldrDigestSource();
    const message = providerMessageFromFixture({
      id: "inline-links-1",
      from: "TLDR <dan@tldrnewsletter.com>",
      subject: "TLDR 2025-11-20",
      htmlBody: `
        <html><body>
          <h1>TLDR 2025-11-20</h1>
          <div>
            <a href="https://tracking.tldrnewsletter.com/CL0/https:%2F%2Fexample.com%2Fsponsor/1/token">
              61% of leaders spend more time proving security rather than improving it (Sponsor)
            </a>
            <p>
              AI-driven attacks are getting bigger, faster, and more sophisticated.
              But Vanta's newest
              <a href="https://tracking.tldrnewsletter.com/CL0/https:%2F%2Fexample.com%2Fstate-of-trust/1/token">
                State of Trust
              </a>
              survey of 3,500 leaders shows that businesses are spending way more time and energy proving trust than building it.
            </p>
            <p>
              Get the
              <a href="https://tracking.tldrnewsletter.com/CL0/https:%2F%2Fexample.com%2Freport/1/token">
                full report
              </a>
              to learn more.
            </p>
          </div>
          <p>Big Tech &amp; Startups</p>
          <div>
            <a href="https://tracking.tldrnewsletter.com/CL0/https:%2F%2Fexample.com%2Fnvidia/1/token">
              Nvidia Profits Soar, Soothing Investor Jitters Over AI Boom (5 minute read)
            </a>
            <p>
              Nvidia reported record sales yesterday.
            </p>
          </div>
          <div>
            <a href="https://tracking.tldrnewsletter.com/CL0/https:%2F%2Fexample.com%2Fapple/1/token">
              Testing shows Apple N1 Wi-Fi chip improves on older Broadcom chips in every way (4 minute read)
            </a>
            <p>
              Detailed benchmarking shows gains across throughput and stability.
            </p>
          </div>
        </body></html>
      `,
    });

    const parsed = source.parse(message);

    expect(parsed.items.map((item) => item.title)).toEqual([
      "61% of leaders spend more time proving security rather than improving it (Sponsor)",
      "Nvidia Profits Soar, Soothing Investor Jitters Over AI Boom (5 minute read)",
      "Testing shows Apple N1 Wi-Fi chip improves on older Broadcom chips in every way (4 minute read)",
    ]);
  });

  it("preserves long item descriptions from the email body", () => {
    const source = new TldrDigestSource();
    const longDescription = `${"Detailed context ".repeat(45)}unique terminal detail that must not be truncated.`;
    const message = providerMessageFromFixture({
      id: "long-summary-1",
      from: "TLDR <dan@tldrnewsletter.com>",
      subject: "TLDR long summary",
      htmlBody: `
        <html><body>
          <p>TOP STORIES</p>
          <div>
            <a href="https://tracking.tldrnewsletter.com/CL0/https:%2F%2Fexample.com%2Flong/1/token">Long story worth reading (6 minute read)</a>
            <p>${longDescription}</p>
          </div>
        </body></html>
      `,
    });

    const parsed = source.parse(message);

    expect(parsed.items[0].summary).toContain(
      "unique terminal detail that must not be truncated.",
    );
    expect(parsed.items[0].summary.length).toBeGreaterThan(420);
  });

  it("supports sender fallback parsing and non-angle-bracket senders", () => {
    expect(parseSender("TLDR <dan@tldrnewsletter.com>")).toEqual({
      senderName: "TLDR",
      senderEmail: "dan@tldrnewsletter.com",
    });

    expect(parseSender("newsletter@tldrnewsletter.com")).toEqual({
      senderName: "newsletter@tldrnewsletter.com",
      senderEmail: "newsletter@tldrnewsletter.com",
    });

    const source = new TldrDigestSource();
    const message = providerMessageFromFixture({
      id: "fallback-1",
      from: "newsletter@tldrnewsletter.com",
      subject: "AI issue",
      htmlBody: `
        <html><body>
          <p>HEADLINES</p>
          <div>
            <a href="https://tracking.tldrnewsletter.com/CL0/https:%2F%2Fexample.com%2Fstory/1/token">Useful story (2 minute read)</a>
            <span>Compact summary text for the parser.</span>
          </div>
        </body></html>
      `,
    });

    expect(source.parse(message).sourceVariant).toBe("TLDR AI");
  });
});

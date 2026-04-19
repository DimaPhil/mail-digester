import {
  FixtureInterestClassifier,
  OpenAIInterestClassifier,
} from "@/lib/inbox/interest-classifier";

const baseAppConfig = {
  id: 1,
  interestPrompt: "openai",
  interestPromptVersion: 3,
  createdAt: Date.parse("2026-04-10T00:00:00Z"),
  updatedAt: Date.parse("2026-04-10T00:00:00Z"),
};

const baseInput = {
  itemId: 10,
  emailId: 20,
  emailReceivedAt: Date.parse("2026-04-10T13:28:17Z"),
  sourceVariant: "TLDR AI",
  emailSubject: "OpenAI roadmap",
  senderName: "TLDR AI",
  senderEmail: "dan@tldrnewsletter.com",
  section: "Headlines",
  position: 0,
  title: "OpenAI sharpens its enterprise roadmap",
  summary: "OpenAI outlined a clearer enterprise packaging strategy.",
  readTimeText: "3 minute read",
  itemKind: "editorial",
  trackedUrl: "https://tracking.tldrnewsletter.com/CL0/https://example.com/1",
  canonicalUrl: "https://example.com/1",
  finalUrl: "https://example.com/1",
};

describe("interest classifier", () => {
  it("returns unclassified when no prompt is configured", async () => {
    const classifier = new FixtureInterestClassifier();

    const result = await classifier.classifyLink(baseInput, {
      ...baseAppConfig,
      interestPrompt: null,
    });

    expect(result.interestStatus).toBe("unclassified");
    expect(result.interestReason).toBeNull();
  });

  it("classifies fixture links based on link-level prompt matches", async () => {
    const classifier = new FixtureInterestClassifier();

    const interesting = await classifier.classifyLink(baseInput, baseAppConfig);
    const notInteresting = await classifier.classifyLink(
      {
        ...baseInput,
        title: "Amazon escalates the infrastructure race",
        summary:
          "Amazon used its annual letter to frame custom silicon as the next moat.",
      },
      baseAppConfig,
    );

    expect(interesting.interestStatus).toBe("interesting");
    expect(notInteresting.interestStatus).toBe("not_interesting");
  });

  it("throws when OpenAI classification is requested without an API key", async () => {
    const classifier = new OpenAIInterestClassifier(null);

    await expect(
      classifier.classifyLink(baseInput, baseAppConfig),
    ).rejects.toThrow(/OPENAI_API_KEY/i);
  });

  it("uses parsed structured output from the OpenAI SDK", async () => {
    const classifier = new OpenAIInterestClassifier("test-key") as any;
    classifier.client = {
      responses: {
        parse: vi.fn(async () => ({
          output_parsed: {
            interesting: true,
            reason: "Direct match with the saved prompt.",
          },
        })),
      },
    };

    const result = await classifier.classifyLink(baseInput, baseAppConfig, {
      model: "gpt-5.4",
    });

    expect(result.interestStatus).toBe("interesting");
    expect(result.interestReason).toBe("Direct match with the saved prompt.");
    expect(result.interestModel).toBe("gpt-5.4");
    expect(result.interestPromptVersion).toBe(3);
  });
});

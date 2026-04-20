import {
  FixtureAiFeatureClassifier,
  OpenAIAiFeatureClassifier,
} from "@/lib/inbox/ai-feature-classifier";

const baseAppConfig = {
  id: 1,
  interestPrompt: null,
  interestPromptVersion: 0,
  aiFeaturePrompt: "openai claude anthropic roadmap panels",
  aiFeaturePromptVersion: 4,
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

describe("ai feature classifier", () => {
  it("returns unclassified when no prompt is configured", async () => {
    const classifier = new FixtureAiFeatureClassifier();

    const result = await classifier.classifyLink(baseInput, {
      ...baseAppConfig,
      aiFeaturePrompt: null,
    });

    expect(result.aiFeatureStatus).toBe("unclassified");
    expect(result.aiFeatureReason).toBeNull();
  });

  it("classifies fixture links based on link-level watchlist matches", async () => {
    const classifier = new FixtureAiFeatureClassifier();

    const included = await classifier.classifyLink(baseInput, baseAppConfig);
    const excluded = await classifier.classifyLink(
      {
        ...baseInput,
        title: "Amazon escalates the infrastructure race",
        summary:
          "Amazon used its annual letter to frame custom silicon as the next moat.",
        emailSubject: "Compute race",
      },
      baseAppConfig,
    );

    expect(included.aiFeatureStatus).toBe("included");
    expect(excluded.aiFeatureStatus).toBe("excluded");
  });

  it("throws when OpenAI classification is requested without an API key", async () => {
    const classifier = new OpenAIAiFeatureClassifier(null);

    await expect(
      classifier.classifyLink(baseInput, baseAppConfig),
    ).rejects.toThrow(/OPENAI_API_KEY/i);
  });

  it("uses parsed structured output from the OpenAI SDK", async () => {
    const classifier = new OpenAIAiFeatureClassifier("test-key") as any;
    classifier.client = {
      responses: {
        parse: vi.fn(async () => ({
          output_parsed: {
            included: true,
            reason: "Concrete AI product capability from a tracked provider.",
          },
        })),
      },
    };

    const result = await classifier.classifyLink(baseInput, baseAppConfig, {
      model: "gpt-5.4",
    });

    expect(result.aiFeatureStatus).toBe("included");
    expect(result.aiFeatureReason).toBe(
      "Concrete AI product capability from a tracked provider.",
    );
    expect(result.aiFeatureModel).toBe("gpt-5.4");
    expect(result.aiFeaturePromptVersion).toBe(4);
  });
});

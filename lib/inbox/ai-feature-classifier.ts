import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { OPENAI_API_KEY, OPENAI_MODEL } from "@/lib/config";
import type {
  AppConfigRecord,
  ItemInterestInputRecord,
} from "@/lib/db/repository";
import {
  aiFeatureStatusFromBoolean,
  normalizeAiFeaturePrompt,
  type AiFeatureClassification,
  UNCLASSIFIED_AI_FEATURE,
} from "@/lib/inbox/ai-feature";
import { nowTs } from "@/lib/utils";

export type AiFeatureClassifierRuntimeConfig = {
  model: string;
};

export interface AiFeatureClassifier {
  classifyLink(
    input: ItemInterestInputRecord,
    appConfig: AppConfigRecord,
    runtimeConfig?: Partial<AiFeatureClassifierRuntimeConfig>,
  ): Promise<AiFeatureClassification>;
}

const AiFeatureDecisionSchema = z.object({
  included: z.boolean(),
  reason: z.string().min(1).max(180),
});

function buildClassificationContext(input: ItemInterestInputRecord) {
  return JSON.stringify(
    {
      link: {
        title: input.title,
        summary: input.summary,
        section: input.section,
        position: input.position,
        itemKind: input.itemKind,
        readTimeText: input.readTimeText,
        url: input.finalUrl ?? input.canonicalUrl ?? input.trackedUrl,
      },
      email: {
        sourceVariant: input.sourceVariant,
        subject: input.emailSubject,
        senderName: input.senderName,
        senderEmail: input.senderEmail,
        receivedAt: new Date(input.emailReceivedAt).toISOString(),
      },
    },
    null,
    2,
  );
}

function buildSystemPrompt(prompt: string) {
  return [
    "You decide whether a newsletter link belongs in the user's AI product capabilities watchlist.",
    "Judge the individual link, not the entire email.",
    "Include a link only when it describes a product, platform, SDK, browser, assistant, model feature, agent feature, or tooling update that gives people a practical new way to learn, build, use, or deploy AI.",
    "Prioritize concrete functionality shipping from major AI providers and major software platforms.",
    "Exclude generic market commentary, policy news, funding news, hiring, broad research coverage without product impact, and links that merely mention AI without a meaningful product capability.",
    "If the link is ambiguous or weakly connected to the user's rubric, exclude it.",
    "The reason must be concise, factual, and under 180 characters.",
    "User rubric:",
    prompt,
  ].join("\n\n");
}

export class FixtureAiFeatureClassifier implements AiFeatureClassifier {
  async classifyLink(
    input: ItemInterestInputRecord,
    appConfig: AppConfigRecord,
  ): Promise<AiFeatureClassification> {
    const prompt = normalizeAiFeaturePrompt(appConfig.aiFeaturePrompt);
    if (!prompt) {
      return UNCLASSIFIED_AI_FEATURE;
    }

    const promptTokens = [
      ...new Set(prompt.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []),
    ];
    const haystack = [
      input.title,
      input.summary,
      input.section,
      input.itemKind,
      input.emailSubject,
    ]
      .join(" ")
      .toLowerCase();
    const matches = promptTokens.filter((token) => haystack.includes(token));
    const included = matches.length > 0;

    return {
      aiFeatureStatus: aiFeatureStatusFromBoolean(included),
      aiFeatureReason: included
        ? `Matched watchlist keywords: ${matches.slice(0, 3).join(", ")}.`
        : "No watchlist keywords matched this link.",
      aiFeatureModel: "fixture-ai-feature-classifier",
      aiFeaturePromptVersion: appConfig.aiFeaturePromptVersion,
      aiFeatureClassifiedAt: nowTs(),
    };
  }
}

export class OpenAIAiFeatureClassifier implements AiFeatureClassifier {
  private readonly client: OpenAI | null;

  constructor(apiKey = OPENAI_API_KEY) {
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async classifyLink(
    input: ItemInterestInputRecord,
    appConfig: AppConfigRecord,
    runtimeConfig: Partial<AiFeatureClassifierRuntimeConfig> = {},
  ): Promise<AiFeatureClassification> {
    const prompt = normalizeAiFeaturePrompt(appConfig.aiFeaturePrompt);
    if (!prompt) {
      return UNCLASSIFIED_AI_FEATURE;
    }

    if (!this.client) {
      throw new Error(
        "OPENAI_API_KEY is required to build the AI feature list with the configured prompt.",
      );
    }

    const response = await this.client.responses.parse({
      model: runtimeConfig.model ?? OPENAI_MODEL,
      input: [
        {
          role: "system",
          content: buildSystemPrompt(prompt),
        },
        {
          role: "user",
          content: buildClassificationContext(input),
        },
      ],
      text: {
        format: zodTextFormat(AiFeatureDecisionSchema, "ai_feature_decision"),
      },
    });

    const output = response.output_parsed;
    if (!output) {
      throw new Error("OpenAI did not return a parsed AI feature decision.");
    }

    return {
      aiFeatureStatus: aiFeatureStatusFromBoolean(output.included),
      aiFeatureReason: output.reason.trim(),
      aiFeatureModel: runtimeConfig.model ?? OPENAI_MODEL,
      aiFeaturePromptVersion: appConfig.aiFeaturePromptVersion,
      aiFeatureClassifiedAt: nowTs(),
    };
  }
}

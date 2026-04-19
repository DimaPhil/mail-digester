import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { OPENAI_API_KEY, OPENAI_MODEL } from "@/lib/config";
import type {
  AppConfigRecord,
  ItemInterestInputRecord,
} from "@/lib/db/repository";
import {
  itemInterestStatusFromBoolean,
  normalizeInterestPrompt,
  type ItemInterestClassification,
  UNCLASSIFIED_ITEM_INTEREST,
} from "@/lib/inbox/interest";
import { nowTs } from "@/lib/utils";

export type InterestClassifierRuntimeConfig = {
  model: string;
};

export interface InterestClassifier {
  classifyLink(
    input: ItemInterestInputRecord,
    appConfig: AppConfigRecord,
    runtimeConfig?: Partial<InterestClassifierRuntimeConfig>,
  ): Promise<ItemInterestClassification>;
}

const InterestDecisionSchema = z.object({
  interesting: z.boolean(),
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
    "You classify whether a newsletter link is interesting to the user.",
    "Decide for the individual link, not the whole email.",
    "Apply the user rubric exactly.",
    "If the link is ambiguous or only weakly related to the rubric, classify it as not interesting.",
    "The reason must be concise, factual, and under 180 characters.",
    "User rubric:",
    prompt,
  ].join("\n\n");
}

export class FixtureInterestClassifier implements InterestClassifier {
  async classifyLink(
    input: ItemInterestInputRecord,
    appConfig: AppConfigRecord,
  ): Promise<ItemInterestClassification> {
    const prompt = normalizeInterestPrompt(appConfig.interestPrompt);
    if (!prompt) {
      return UNCLASSIFIED_ITEM_INTEREST;
    }

    const promptTokens = [
      ...new Set(prompt.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []),
    ];
    const haystack = [input.title, input.summary, input.section, input.itemKind]
      .join(" ")
      .toLowerCase();
    const matches = promptTokens.filter((token) => haystack.includes(token));
    const interesting = matches.length > 0;

    return {
      interestStatus: itemInterestStatusFromBoolean(interesting),
      interestReason: interesting
        ? `Matched prompt keywords: ${matches.slice(0, 3).join(", ")}.`
        : "No prompt keywords matched this link.",
      interestModel: "fixture-interest-classifier",
      interestPromptVersion: appConfig.interestPromptVersion,
      interestClassifiedAt: nowTs(),
    };
  }
}

export class OpenAIInterestClassifier implements InterestClassifier {
  private readonly client: OpenAI | null;

  constructor(apiKey = OPENAI_API_KEY) {
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async classifyLink(
    input: ItemInterestInputRecord,
    appConfig: AppConfigRecord,
    runtimeConfig: Partial<InterestClassifierRuntimeConfig> = {},
  ): Promise<ItemInterestClassification> {
    const prompt = normalizeInterestPrompt(appConfig.interestPrompt);
    if (!prompt) {
      return UNCLASSIFIED_ITEM_INTEREST;
    }

    if (!this.client) {
      throw new Error(
        "OPENAI_API_KEY is required to classify links with the configured interest prompt.",
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
        format: zodTextFormat(InterestDecisionSchema, "interest_decision"),
      },
    });

    const output = response.output_parsed;
    if (!output) {
      throw new Error("OpenAI did not return a parsed interest decision.");
    }

    return {
      interestStatus: itemInterestStatusFromBoolean(output.interesting),
      interestReason: output.reason.trim(),
      interestModel: runtimeConfig.model ?? OPENAI_MODEL,
      interestPromptVersion: appConfig.interestPromptVersion,
      interestClassifiedAt: nowTs(),
    };
  }
}

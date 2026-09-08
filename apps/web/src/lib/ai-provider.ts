import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { env } from "@superfact/env/server";

import { modelConfigFor } from "@/lib/ai-provider-config";

export const AI_PROVIDER = env.AI_PROVIDER;
export const SELECTED_MODELS = modelConfigFor(AI_PROVIDER);

let openAIProvider: ReturnType<typeof createOpenAI> | undefined;
let googleProvider: ReturnType<typeof createGoogle> | undefined;

function requiredKey(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required when AI_PROVIDER=${AI_PROVIDER}`);
  }
  return value;
}

function selectedOpenAI() {
  openAIProvider ??= createOpenAI({ apiKey: requiredKey(env.OPENAI_API_KEY, "OPENAI_API_KEY") });
  return openAIProvider;
}

function selectedGoogle() {
  googleProvider ??= createGoogle({
    apiKey: requiredKey(env.GOOGLE_GENERATIVE_AI_API_KEY, "GOOGLE_GENERATIVE_AI_API_KEY"),
  });
  return googleProvider;
}

export function extractionLanguageModel() {
  return AI_PROVIDER === "gemini"
    ? selectedGoogle()(SELECTED_MODELS.extraction)
    : selectedOpenAI().responses(SELECTED_MODELS.extraction);
}

export function adjudicationLanguageModel() {
  return AI_PROVIDER === "gemini"
    ? selectedGoogle()(SELECTED_MODELS.adjudication)
    : selectedOpenAI().responses(SELECTED_MODELS.adjudication);
}

export function embeddingLanguageModel() {
  return AI_PROVIDER === "gemini"
    ? selectedGoogle().embeddingModel(SELECTED_MODELS.embedding)
    : selectedOpenAI().embeddingModel(SELECTED_MODELS.embedding);
}

type AdjudicationProviderOptions =
  | { google: { thinkingConfig: { thinkingLevel: "high" } } }
  | { openai: { reasoningEffort: "high" } };

export function adjudicationProviderOptions(
  escalate?: boolean,
): AdjudicationProviderOptions | undefined {
  if (!escalate) return undefined;

  return AI_PROVIDER === "gemini"
    ? { google: { thinkingConfig: { thinkingLevel: "high" as const } } }
    : { openai: { reasoningEffort: "high" as const } };
}

export function embeddingProviderOptions(outputDimensionality: number) {
  return AI_PROVIDER === "gemini" ? { google: { outputDimensionality } } : undefined;
}

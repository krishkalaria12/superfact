export const AI_PROVIDERS = ["openai", "gemini"] as const;

export type AIProvider = (typeof AI_PROVIDERS)[number];

export const MODEL_CONFIG = {
  openai: {
    extraction: "gpt-5.6-luna",
    adjudication: "gpt-5.6-terra",
    embedding: "text-embedding-3-small",
  },
  gemini: {
    extraction: "gemini-3.8-flash",
    adjudication: "gemini-3.8-flash",
    embedding: "gemini-embedding-2",
  },
} as const satisfies Record<
  AIProvider,
  { extraction: string; adjudication: string; embedding: string }
>;

export function modelConfigFor(provider: AIProvider) {
  return MODEL_CONFIG[provider];
}

export function pipelineVersionFor(baseVersion: string, provider: AIProvider): string {
  return `${baseVersion}-${provider}`;
}

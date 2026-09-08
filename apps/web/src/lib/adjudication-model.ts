import { APICallError, generateText, Output } from "ai";
import { z } from "zod";

import {
  adjudicationLanguageModel,
  adjudicationProviderOptions,
  SELECTED_MODELS,
} from "@/lib/ai-provider";
import type { AdjudicationModel } from "@/lib/adjudication";
import { PermanentModelFailure } from "@/lib/model-errors";

export const ADJUDICATION_MODEL = SELECTED_MODELS.adjudication;

/** The selected provider uses high reasoning only for the contradiction second pass. */
export const adjudicationModel: AdjudicationModel = {
  async generate<T>({
    name,
    system,
    prompt,
    schema,
    escalate,
  }: Parameters<AdjudicationModel["generate"]>[0]) {
    const wrappedSchema = z.object({ data: schema });
    let output: { data: unknown };
    try {
      ({ output } = await generateText({
        model: adjudicationLanguageModel(),
        maxRetries: 0,
        system,
        prompt,
        providerOptions: adjudicationProviderOptions(escalate),
        output: Output.object({
          name,
          description: "How two assertions from two documents relate",
          schema: wrappedSchema,
        }),
      }));
    } catch (error) {
      if (APICallError.isInstance(error) && !error.isRetryable) {
        throw new PermanentModelFailure(error.message, { cause: error });
      }
      throw error;
    }

    return output.data as T;
  },
};

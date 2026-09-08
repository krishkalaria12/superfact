import { APICallError, generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";

import { extractionLanguageModel, SELECTED_MODELS } from "@/lib/ai-provider";
import { StructuredOutputFailure } from "@/lib/extract";
import type { StructuredOutputModel } from "@/lib/extract";
import { PermanentModelFailure } from "@/lib/model-errors";

export const EXTRACTION_MODEL = SELECTED_MODELS.extraction;

/** AI SDK v7 adapter kept behind the extractor's small test interface. */
export const extractionModel: StructuredOutputModel = {
  async generate<T>({
    name,
    system,
    prompt,
    schema,
  }: Parameters<StructuredOutputModel["generate"]>[0]) {
    const wrappedSchema = z.object({ data: schema });
    let output: { data: unknown };
    try {
      ({ output } = await generateText({
        model: extractionLanguageModel(),
        maxRetries: 0,
        system,
        prompt,
        output: Output.object({
          name,
          description: "Atomic assertions copied from the supplied document data",
          schema: wrappedSchema,
        }),
      }));
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        throw new StructuredOutputFailure(error.message, { cause: error });
      }
      if (APICallError.isInstance(error) && !error.isRetryable) {
        throw new PermanentModelFailure(error.message, { cause: error });
      }
      throw error;
    }

    return output.data as T;
  },
};

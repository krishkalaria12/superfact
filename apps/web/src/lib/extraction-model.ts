import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";

import type { StructuredOutputModel } from "@/lib/extract";

export const EXTRACTION_MODEL = "gpt-5.6-luna";

/** AI SDK v7 adapter kept behind the extractor's small test interface. */
export const extractionModel: StructuredOutputModel = {
  async generate<T>({
    name,
    system,
    prompt,
    schema,
  }: Parameters<StructuredOutputModel["generate"]>[0]) {
    const wrappedSchema = z.object({ data: schema });
    const { output } = await generateText({
      model: openai.responses(EXTRACTION_MODEL),
      system,
      prompt,
      output: Output.object({
        name,
        description: "Atomic assertions copied from the supplied document data",
        schema: wrappedSchema,
      }),
    });

    return output.data as T;
  },
};

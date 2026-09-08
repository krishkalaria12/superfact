import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";

import type { AdjudicationModel } from "@/lib/adjudication";

export const ADJUDICATION_MODEL = "gpt-5.6-terra";

/**
 * Terra for every pair, Terra at high reasoning effort for the contradiction second pass.
 *
 * Escalation answers to one condition rather than to a risk score: a first pass that said
 * `contradicts`. That keeps the expensive call to tens of pairs instead of thousands, and spends it
 * exactly where the product's precision is judged.
 */
export const adjudicationModel: AdjudicationModel = {
  async generate<T>({
    name,
    system,
    prompt,
    schema,
    escalate,
  }: Parameters<AdjudicationModel["generate"]>[0]) {
    const wrappedSchema = z.object({ data: schema });
    const { output } = await generateText({
      model: openai.responses(ADJUDICATION_MODEL),
      system,
      prompt,
      providerOptions: escalate ? { openai: { reasoningEffort: "high" } } : {},
      output: Output.object({
        name,
        description: "How two assertions from two documents relate",
        schema: wrappedSchema,
      }),
    });

    return output.data as T;
  },
};

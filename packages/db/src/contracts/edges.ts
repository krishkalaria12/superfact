import { z } from "zod";

import { edgeReasonCode, edgeVerdict } from "../schema/edges";

export const verdictSchema = z.enum(edgeVerdict.enumValues);
export const reasonCodeSchema = z.enum(edgeReasonCode.enumValues);

/** The dimensions adjudication compares on. A contradiction needs the decisive ones matched. */
export const comparisonFields = [
  "subject",
  "predicate",
  "time",
  "scope",
  "unit",
  "value",
  "modality",
  "attribution",
] as const;

export const comparisonFieldSchema = z.enum(comparisonFields);

export type ComparisonField = z.infer<typeof comparisonFieldSchema>;

/** What the first adjudication pass concluded, kept when the second pass overturned it. */
export const priorPassSchema = z.object({
  verdict: verdictSchema,
  explanation: z.string().min(1),
});

/**
 * One judged pair.
 *
 * `matchedFields` is what licenses a `contradicts`: the decisive context has to be demonstrably
 * the same before a conflict can be claimed. Where the decisive context is missing rather than
 * different, the verdict is `insufficient` and the reason code says so.
 */
export const claimEdgeSchema = z.object({
  id: z.uuid(),
  sourceAssertionId: z.uuid(),
  targetAssertionId: z.uuid(),
  verdict: verdictSchema,
  reasonCode: reasonCodeSchema,
  matchedFields: z.array(comparisonFieldSchema),
  mismatchedFields: z.array(comparisonFieldSchema),
  explanation: z.string().min(1),
  confidence: z.number().nullable(),
  priorPass: priorPassSchema.nullable(),
  pipelineVersion: z.string().min(1),
});

export type ClaimEdge = z.infer<typeof claimEdgeSchema>;

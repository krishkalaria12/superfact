import { z } from "zod";

import {
  assertionModality,
  assertionRejectionReason,
  assertionSource,
  periodPrecision,
  valueType,
} from "../schema/assertions.ts";
import { bboxSchema } from "./geometry.ts";
import { qualifiersSchema, tableContextSchema } from "./context.ts";

export const modalitySchema = z.enum(assertionModality.enumValues);
export const sourceSchema = z.enum(assertionSource.enumValues);
export const valueTypeSchema = z.enum(valueType.enumValues);
export const periodPrecisionSchema = z.enum(periodPrecision.enumValues);

/**
 * A period as an interval plus how precisely it was stated, so FY2024, Q3, and calendar 2024 stay
 * comparable. Both bounds are inclusive ISO dates.
 */
export const periodSchema = z.object({
  start: z.iso.date(),
  end: z.iso.date(),
  precision: periodPrecisionSchema,
});

export type Period = z.infer<typeof periodSchema>;

/**
 * The span a claim rests on.
 *
 * `quote` has to appear character-for-character in the stored page text and every id in `lineIds`
 * has to exist on that page. Both are checked in code with no model involved, and an assertion
 * that fails either one never reaches the published tier.
 */
export const evidenceSchema = z.object({
  quote: z.string().min(1),
  lineIds: z.array(z.string().min(1)).min(1),
  /** Union of the cited lines' boxes. Null until the parser's geometry has been joined in. */
  bbox: bboxSchema.nullable(),
});

export type Evidence = z.infer<typeof evidenceSchema>;

/**
 * What the extractor is allowed to produce.
 *
 * Everything the model does not get to decide is absent by construction: no id, no canonical
 * value, no bounding box, and above all no `verified` flag. The model proposes a claim and points
 * at lines; code decides whether that claim is grounded.
 */
export const assertionCandidateSchema = z.object({
  subject: z.string().min(1),
  predicate: z.string().min(1),
  rawValue: z.string().min(1),
  unit: z.string().nullable(),
  valueType: valueTypeSchema,
  qualifiers: qualifiersSchema,
  modality: modalitySchema,
  /** Set when the document credits the claim to someone else. Null when it asserts it directly. */
  attributedTo: z.string().nullable(),
  source: sourceSchema,
  tableContext: tableContextSchema.nullable(),
  evidence: evidenceSchema.omit({ bbox: true }),
  confidence: z.number().min(0).max(1).nullable(),
});

export type AssertionCandidate = z.infer<typeof assertionCandidateSchema>;

const assertionBase = z.object({
  id: z.uuid(),
  documentId: z.uuid(),
  page: z.number().int().positive(),
  subject: z.string().min(1),
  predicate: z.string().min(1),
  rawValue: z.string().min(1),
  canonicalValue: z.string().nullable(),
  canonicalNumber: z.number().nullable(),
  unit: z.string().nullable(),
  valueType: valueTypeSchema,
  normalizationRule: z.string().nullable(),
  period: periodSchema.nullable(),
  qualifiers: qualifiersSchema,
  modality: modalitySchema,
  attributedTo: z.string().nullable(),
  source: sourceSchema,
  tableContext: tableContextSchema.nullable(),
  evidence: evidenceSchema,
  confidence: z.number().nullable(),
  salience: z.number().nullable(),
  pipelineVersion: z.string().min(1),
});

/**
 * A fact the system stands behind. The two literal `true`s are the point: a published assertion
 * that passed neither gate cannot be constructed, so the invariant is a type error rather than a
 * convention.
 */
export const publishedAssertionSchema = assertionBase.extend({
  status: z.literal("published"),
  verified: z.literal(true),
  contextComplete: z.literal(true),
});

export type PublishedAssertion = z.infer<typeof publishedAssertionSchema>;

/**
 * A candidate the grounding gate refused. It keeps every field the published form has, because
 * the failures view has to show the reviewer what was nearly published and why it was not.
 */
export const rejectedAssertionSchema = assertionBase.extend({
  status: z.literal("rejected"),
  verified: z.boolean(),
  contextComplete: z.boolean(),
  rejectionReason: z.enum(assertionRejectionReason.enumValues),
  rejectionDetail: z.string().nullable(),
});

export type RejectedAssertion = z.infer<typeof rejectedAssertionSchema>;

/** Either publication state, discriminated on `status`. */
export const storedAssertionSchema = z.discriminatedUnion("status", [
  publishedAssertionSchema,
  rejectedAssertionSchema,
]);

export type StoredAssertion = z.infer<typeof storedAssertionSchema>;

import assert from "node:assert/strict";
import test from "node:test";

import { assertionCandidateSchema } from "@superfact/db/contracts";

import { extractAssertionCandidates } from "./extract.ts";
import type { ExtractionPage, StructuredOutputModel } from "./types.ts";

function page(): ExtractionPage {
  return {
    documentId: "doc-a",
    pageNumber: 1,
    lines: [
      {
        id: "p1l1",
        text: "Revenue for FY2024 was 100 in India.",
        bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
        size: 10,
      },
    ],
    tables: [],
  };
}

function modelReturning(qualifiers: { key: string; value: string }[]): StructuredOutputModel {
  return {
    async generate() {
      return [
        {
          subject: "Revenue",
          predicate: "revenue",
          rawValue: "100",
          unit: null,
          valueType: "number",
          qualifiers,
          modality: "observed",
          attributedTo: null,
          evidence: { quote: "Revenue for FY2024 was 100 in India.", lineIds: ["p1l1"] },
          confidence: 0.9,
        },
      ];
    },
  };
}

test("drops qualifiers that repeat structure the parser already supplied", async () => {
  // `cellId` can never match another assertion's, and a copied `title` matches for the wrong
  // reason. Adjudication compares scope on shared qualifier keys, so both are worse than nothing.
  const result = await extractAssertionCandidates(
    [page()],
    modelReturning([
      { key: "fiscal_year", value: "FY2024" },
      { key: "geography", value: "India" },
      { key: "title", value: "Revenue by segment" },
      { key: "cellId", value: "p9t1-r10-c4" },
      { key: "columnHeader", value: "FY2024" },
    ]),
  );

  const qualifiers = result.candidates[0]?.candidate.qualifiers;
  assert.deepEqual(qualifiers, { fiscal_year: "FY2024", geography: "India" });
});

test("keeps every qualifier that actually narrows the claim", async () => {
  const result = await extractAssertionCandidates(
    [page()],
    modelReturning([
      { key: "segment", value: "Express" },
      { key: "reporting_basis", value: "consolidated" },
    ]),
  );

  assert.deepEqual(result.candidates[0]?.candidate.qualifiers, {
    segment: "Express",
    reporting_basis: "consolidated",
  });
  assert.equal(assertionCandidateSchema.safeParse(result.candidates[0]?.candidate).success, true);
});

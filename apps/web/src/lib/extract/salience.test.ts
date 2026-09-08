import assert from "node:assert/strict";
import test from "node:test";

import type { AssertionCandidate } from "@superfact/db/contracts";

import { computeSalience } from "./salience.ts";

function candidate(overrides: Partial<AssertionCandidate> = {}): AssertionCandidate {
  return {
    subject: "Annual land-cover dataset",
    predicate: "contains classes",
    rawValue: "16",
    unit: "classes",
    valueType: "number",
    qualifiers: {},
    modality: "observed",
    attributedTo: null,
    source: "prose",
    tableContext: null,
    evidence: { quote: "The dataset contains 16 classes.", lineIds: ["p1l1"] },
    confidence: 0.9,
    ...overrides,
  };
}

test("ranks subject-matter numbers above document metadata", () => {
  const fact = computeSalience(candidate(), "doc-a");
  const pageNumber = computeSalience(
    candidate({ subject: "Appendix", predicate: "displays page number" }),
    "doc-a",
  );
  const filingCode = computeSalience(
    candidate({ subject: "Company", predicate: "has registration number" }),
    "doc-a",
  );

  assert.equal(fact, 0.6);
  assert.equal(pageNumber, 0.05);
  assert.equal(filingCode, 0.05);
});

test("ranks parser-generated table labels as low signal", () => {
  const score = computeSalience(
    candidate({ subject: "p19t3-r8", predicate: "value for 2024" }),
    "doc-a",
  );

  assert.equal(score, 0.05);
});

test("ranks bibliography metadata as low signal", () => {
  const bibliographyFact = candidate({
    subject: "A land cover classification system",
    predicate: "was published in",
    rawValue: "1976",
    evidence: {
      quote: "Anderson and others, 1976, U.S. Geological Survey Professional Paper 964",
      lineIds: ["p4l65"],
    },
  });

  assert.equal(computeSalience(bibliographyFact, "document-a"), 0.05);
});

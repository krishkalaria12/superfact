import assert from "node:assert/strict";
import test from "node:test";

import { buildCandidatePairs } from "./pair.ts";
import { tokenAffinity } from "./predicates.ts";
import type { PairingAssertion, RetrievedPair } from "./types.ts";
import { canonicalValuesEqual, unitsComparable, valueTypesCompatible } from "./values.ts";

function assertion(overrides: Partial<PairingAssertion> & { id: string }): PairingAssertion {
  return {
    documentId: "doc-a",
    subject: "Revenue from operations",
    predicate: "revenue",
    valueType: "money",
    unit: "INR",
    canonicalValue: "81415380000",
    canonicalNumber: 81_415_380_000,
    ...overrides,
  };
}

function pair(
  source: string,
  target: string,
  path: RetrievedPair["path"],
  similarity: number | null = null,
): RetrievedPair {
  return { sourceAssertionId: source, targetAssertionId: target, path, similarity };
}

test("the deterministic path matches across scales that vectors would miss", () => {
  // The same rupee amount written two ways. Nothing about "7,225 crore" and "72.25 billion" is
  // close in vector space; both normalize to one number, which is the point of the path.
  const crore = assertion({
    id: "a",
    canonicalValue: "72250000000",
    canonicalNumber: 72_250_000_000,
  });
  const billion = assertion({
    id: "b",
    documentId: "doc-b",
    subject: "Revenue",
    predicate: "revenue",
    canonicalValue: "72250000000",
    canonicalNumber: 72_250_000_000,
  });

  const result = buildCandidatePairs({
    focus: [crore],
    corpus: [billion],
    retrieved: [pair("a", "b", "deterministic")],
  });

  assert.equal(result.pairs.length, 1);
  assert.deepEqual(result.pairs[0]?.paths, ["deterministic"]);
  assert.equal(result.pairs[0]?.valuesEqual, true);
});

test("a pair both paths found carries both, not two entries", () => {
  const left = assertion({ id: "a" });
  const right = assertion({ id: "b", documentId: "doc-b" });

  const result = buildCandidatePairs({
    focus: [left],
    corpus: [right],
    // Also proposed with the ids the other way round, as a second path may well report it.
    retrieved: [pair("a", "b", "deterministic"), pair("b", "a", "semantic", 0.91)],
  });

  assert.equal(result.pairs.length, 1);
  assert.deepEqual(result.pairs[0]?.paths, ["deterministic", "semantic"]);
  assert.equal(result.pairs[0]?.similarity, 0.91);
});

test("keeps a pair whose time, unit, and scope differ", () => {
  // Precisely the differences phase 07 reconciles. A prefilter that removed them would leave the
  // adjudicator only the pairs that need no explaining.
  const inr = assertion({ id: "a" });
  const usd = assertion({
    id: "b",
    documentId: "doc-b",
    subject: "Revenue, North India",
    predicate: "revenue",
    unit: "USD",
    canonicalValue: "977000000",
    canonicalNumber: 977_000_000,
  });

  const result = buildCandidatePairs({
    focus: [inr],
    corpus: [usd],
    retrieved: [pair("a", "b", "semantic", 0.82)],
  });

  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0]?.valuesEqual, false);
  assert.equal(result.pairs[0]?.unitsComparable, false);
});

test("sends a semantically opposite but lexically similar claim to be judged", () => {
  const grew = assertion({
    id: "a",
    subject: "National output",
    predicate: "grew year over year",
    valueType: "percent",
    unit: "percent",
    canonicalValue: "6.5",
    canonicalNumber: 6.5,
  });
  const shrank = assertion({
    id: "b",
    documentId: "doc-b",
    subject: "National output",
    predicate: "shrank year over year",
    valueType: "percent",
    unit: "percent",
    canonicalValue: "-6.5",
    canonicalNumber: -6.5,
  });

  const result = buildCandidatePairs({
    focus: [grew],
    corpus: [shrank],
    retrieved: [pair("a", "b", "semantic", 0.94)],
  });

  // Similarity gets it in front of the adjudicator and says nothing about which way it goes.
  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0]?.valuesEqual, false);
});

test("drops pairs whose value types cannot describe the same quantity", () => {
  const money = assertion({ id: "a", canonicalValue: "6.5", canonicalNumber: 6.5 });
  const percent = assertion({
    id: "b",
    documentId: "doc-b",
    valueType: "percent",
    unit: "percent",
    canonicalValue: "6.5",
    canonicalNumber: 6.5,
  });

  const result = buildCandidatePairs({
    focus: [money],
    corpus: [percent],
    retrieved: [pair("a", "b", "deterministic")],
  });

  assert.equal(result.pairs.length, 0);
  assert.equal(result.excluded[0]?.reason, "value_type");
});

test("drops a numeric coincidence between unrelated predicates", () => {
  const revenue = assertion({ id: "a" });
  const headcount = assertion({
    id: "b",
    documentId: "doc-b",
    subject: "Employees",
    predicate: "headcount",
    valueType: "number",
    unit: null,
  });

  const result = buildCandidatePairs({
    focus: [revenue],
    corpus: [headcount],
    retrieved: [pair("a", "b", "deterministic")],
  });

  assert.equal(result.pairs.length, 0);
  assert.equal(result.excluded[0]?.reason, "predicate");
});

test("never pairs a document with itself", () => {
  const result = buildCandidatePairs({
    focus: [assertion({ id: "a" }), assertion({ id: "b" })],
    corpus: [],
    retrieved: [pair("a", "b", "deterministic")],
  });

  assert.equal(result.pairs.length, 0);
  assert.equal(result.excluded[0]?.reason, "same_document");
});

test("ranks a value match ahead of every semantic neighbour without dropping any", () => {
  const focus = assertion({ id: "focus" });
  const exact = assertion({
    id: "exact",
    documentId: "doc-b",
    subject: "Revenue",
    predicate: "revenue",
  });
  const neighbours = Array.from({ length: 5 }, (_, index) =>
    assertion({
      id: `near-${index}`,
      documentId: "doc-b",
      canonicalValue: `${index}`,
      canonicalNumber: index,
    }),
  );

  const result = buildCandidatePairs({
    focus: [focus],
    corpus: [exact, ...neighbours],
    retrieved: [
      ...neighbours.map((item) => pair("focus", item.id, "semantic", 0.99)),
      pair("focus", "exact", "deterministic"),
    ],
  });

  assert.equal(result.pairs.length, 6);
  assert.equal(result.pairs[0]?.targetAssertionId, "exact");
  assert.deepEqual(result.excluded, []);
});

test("drops vector neighbours below the similarity floor", () => {
  const result = buildCandidatePairs({
    focus: [assertion({ id: "a", canonicalValue: "1", canonicalNumber: 1 })],
    corpus: [assertion({ id: "b", documentId: "doc-b", canonicalValue: "2", canonicalNumber: 2 })],
    retrieved: [pair("a", "b", "semantic", 0.2)],
  });

  assert.equal(result.pairs.length, 0);
  assert.equal(result.excluded[0]?.reason, "similarity_floor");
});

test("drops weak cross-domain neighbours that only share generic language", () => {
  const landCover = assertion({
    id: "a",
    subject: "Land cover class 52",
    predicate: "has label",
    valueType: "text",
    unit: null,
    canonicalValue: "Shrub/scrub",
    canonicalNumber: null,
  });
  const filingTable = assertion({
    id: "b",
    documentId: "doc-b",
    subject: "Particulars",
    predicate: "unit label",
    valueType: "text",
    unit: null,
    canonicalValue: "in rupees",
    canonicalNumber: null,
  });

  const result = buildCandidatePairs({
    focus: [landCover],
    corpus: [filingTable],
    retrieved: [pair("a", "b", "semantic", 0.54)],
  });

  assert.equal(result.pairs.length, 0);
  assert.equal(result.excluded[0]?.reason, "claim_relation");
});

test("does not treat the generic predicate includes as a claim anchor", () => {
  const landCover = assertion({
    id: "a",
    subject: "Annual NLCD",
    predicate: "includes",
    valueType: "text",
    unit: null,
    canonicalValue: "Spectral Change Day of Year",
    canonicalNumber: null,
  });
  const foodCategory = assertion({
    id: "b",
    documentId: "doc-b",
    subject: "Others",
    predicate: "includes",
    valueType: "text",
    unit: null,
    canonicalValue: "prepared meals",
    canonicalNumber: null,
  });

  const result = buildCandidatePairs({
    focus: [landCover],
    corpus: [foodCategory],
    retrieved: [pair("a", "b", "semantic", 0.56)],
  });

  assert.equal(result.pairs.length, 0);
  assert.equal(result.excluded[0]?.reason, "claim_relation");
});

test("keeps a strong semantic paraphrase without shared words", () => {
  const sales = assertion({
    id: "a",
    subject: "Sales",
    predicate: "climbed",
    canonicalValue: "100",
    canonicalNumber: 100,
  });
  const revenue = assertion({
    id: "b",
    documentId: "doc-b",
    subject: "Revenue",
    predicate: "increased",
    canonicalValue: "110",
    canonicalNumber: 110,
  });

  const result = buildCandidatePairs({
    focus: [sales],
    corpus: [revenue],
    retrieved: [pair("a", "b", "semantic", 0.83)],
  });

  assert.equal(result.pairs.length, 1);
});

test("reads a containment relation as one predicate", () => {
  assert.equal(tokenAffinity("revenue", "revenue"), 1);
  assert.ok(tokenAffinity("revenue", "revenue from operations") >= 0.5);
  assert.ok(tokenAffinity("revenue growth", "growth in revenue") === 1);
  assert.equal(tokenAffinity("revenue", "employee headcount"), 0);
});

test("compares canonical values and units without guessing", () => {
  assert.ok(valueTypesCompatible("money", "number"));
  assert.ok(!valueTypesCompatible("money", "percent"));
  assert.ok(!valueTypesCompatible("date", "number"));

  assert.ok(unitsComparable("INR", "inr"));
  assert.ok(unitsComparable("INR", null));
  assert.ok(!unitsComparable("INR", "USD"));

  const equal = canonicalValuesEqual(
    { canonicalValue: "100", canonicalNumber: 100 },
    { canonicalValue: "100.0", canonicalNumber: 100 },
  );
  assert.ok(equal, "numbers decide when both sides normalized to one");
  assert.ok(
    !canonicalValuesEqual(
      { canonicalValue: "100", canonicalNumber: 100 },
      { canonicalValue: "100", canonicalNumber: null },
    ),
    "a number against an unnormalized string is not an agreement",
  );
});

test("sends every relevant pair to adjudication without a capacity cap", () => {
  const focus = Array.from({ length: 6 }, (_, index) => assertion({ id: `f${index}` }));
  const corpus = Array.from({ length: 6 }, (_, index) =>
    assertion({ id: `t${index}`, documentId: "doc-b" }),
  );

  const result = buildCandidatePairs({
    focus,
    corpus,
    retrieved: focus.flatMap((source) =>
      corpus.map((target) => pair(source.id, target.id, "deterministic")),
    ),
  });

  assert.equal(result.pairs.length, 36);
  assert.equal(result.stats.pairs, 36);
  assert.equal(result.stats.capped, 0);
  assert.deepEqual(result.excluded, []);
});

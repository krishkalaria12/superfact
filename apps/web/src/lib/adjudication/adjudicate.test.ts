import assert from "node:assert/strict";
import test from "node:test";

import type { PublishedAssertion } from "@superfact/db/contracts";

import { adjudicatePairs, orderPair } from "./adjudicate.ts";
import { compareAssertions } from "./compare.ts";
import type { AdjudicationModel, AdjudicationRequest } from "./types.ts";

let nextId = 1;

function assertion(overrides: Partial<PublishedAssertion> = {}): PublishedAssertion {
  return {
    id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
    documentId: "doc-a",
    page: 1,
    subject: "Revenue from operations",
    predicate: "revenue",
    rawValue: "₹81,415.38 million",
    canonicalValue: "81415380000",
    canonicalNumber: 81_415_380_000,
    unit: "INR",
    valueType: "money",
    normalizationRule: "money.scale",
    period: { start: "2023-04-01", end: "2024-03-31", precision: "fiscal_year" },
    qualifiers: { geography: "India" },
    modality: "observed",
    attributedTo: null,
    source: "prose",
    tableContext: null,
    evidence: { quote: "Revenue was ₹81,415.38 million.", lineIds: ["p1l1"], bbox: null },
    confidence: 0.9,
    salience: 0.8,
    pipelineVersion: "test",
    status: "published",
    verified: true,
    contextComplete: true,
    ...overrides,
  };
}

/** A model that answers from a script, and records what it was asked. */
function scriptedModel(
  replies: unknown[],
): AdjudicationModel & { calls: AdjudicationRequest<unknown>[] } {
  const calls: AdjudicationRequest<unknown>[] = [];
  let index = 0;
  return {
    calls,
    async generate(request) {
      calls.push(request as AdjudicationRequest<unknown>);
      const reply = replies[index++];
      if (reply === undefined) throw new Error("model called more times than the script allows");
      return reply;
    },
  };
}

const contradictionReply = {
  verdict: "contradicts",
  reasonCode: "exact_duplicate",
  contextMatches: ["time", "scope", "unit", "modality", "attribution"],
  explanation: "The two documents report different revenue for the same year.",
  confidence: 0.8,
};

test("settles an equivalent value without asking a model", async () => {
  const source = assertion();
  const target = assertion({
    documentId: "doc-b",
    subject: "Revenue",
    rawValue: "₹8,141.538 crore",
  });
  const model = scriptedModel([]);

  const result = await adjudicatePairs([{ source, target }], model, "test");

  assert.equal(model.calls.length, 0, "an exact numeric agreement costs nothing to judge");
  assert.equal(result.stats.settled, 1);
  assert.equal(result.edges[0]?.verdict, "corroborates");
  assert.equal(result.edges[0]?.reasonCode, "equivalent_value");
});

test("calls a duplicate a duplicate when both documents printed the same string", async () => {
  const source = assertion();
  const target = assertion({ documentId: "doc-b" });

  const result = await adjudicatePairs([{ source, target }], scriptedModel([]), "test");

  assert.equal(result.edges[0]?.reasonCode, "exact_duplicate");
});

test("does not settle across a modality difference", async () => {
  // Same number, but one document observed it and the other forecast it. That is two claims.
  const source = assertion();
  const target = assertion({ documentId: "doc-b", modality: "projected" });
  const model = scriptedModel([
    {
      verdict: "reconciles",
      reasonCode: "projection_vs_actual",
      contextMatches: [],
      explanation: "One figure is reported, the other projected.",
      confidence: 0.7,
    },
  ]);

  const result = await adjudicatePairs([{ source, target }], model, "test");

  assert.equal(model.calls.length, 1);
  assert.equal(result.edges[0]?.verdict, "reconciles");
  assert.ok(result.edges[0]?.mismatchedFields.includes("modality"));
});

test("does not settle across an attribution difference", async () => {
  // "GDP will grow 6.5%" against "the RBI projects 6.5%". The named risk of this phase.
  const source = assertion({ modality: "projected" });
  const target = assertion({ documentId: "doc-b", modality: "projected", attributedTo: "RBI" });
  const model = scriptedModel([
    {
      verdict: "insufficient",
      reasonCode: "attribution_mismatch",
      contextMatches: [],
      explanation: "One document asserts the figure, the other reports the RBI asserting it.",
      confidence: 0.6,
    },
  ]);

  const result = await adjudicatePairs([{ source, target }], model, "test");

  assert.equal(model.calls.length, 1);
  assert.ok(result.edges[0]?.mismatchedFields.includes("attribution"));
});

test("withholds a contradiction when the periods differ", async () => {
  const source = assertion({ canonicalNumber: 100, canonicalValue: "100", rawValue: "100" });
  const target = assertion({
    documentId: "doc-b",
    canonicalNumber: 120,
    canonicalValue: "120",
    rawValue: "120",
    period: { start: "2024-04-01", end: "2025-03-31", precision: "fiscal_year" },
  });
  const model = scriptedModel([contradictionReply]);

  const result = await adjudicatePairs([{ source, target }], model, "test");

  // The model said contradicts and claimed time matched. Code compared the periods itself and
  // they do not, so the claim is refused rather than believed.
  assert.equal(model.calls.length, 1, "a withheld contradiction never reaches the second pass");
  assert.equal(result.edges[0]?.verdict, "insufficient");
  assert.equal(result.stats.withheld, 1);
  assert.equal(result.stats.contradicts, 0);
  assert.ok(result.edges[0]?.explanation.startsWith("Withheld a contradiction: time"));
});

test("withholds a contradiction when a decisive field was never comparable", async () => {
  const source = assertion({ canonicalNumber: 100, canonicalValue: "100", rawValue: "100" });
  const target = assertion({
    documentId: "doc-b",
    canonicalNumber: 120,
    canonicalValue: "120",
    rawValue: "120",
    unit: null,
  });
  const model = scriptedModel([{ ...contradictionReply, contextMatches: ["time", "scope"] }]);

  const result = await adjudicatePairs([{ source, target }], model, "test");

  assert.equal(result.edges[0]?.verdict, "insufficient");
  assert.equal(result.edges[0]?.reasonCode, "missing_context");
  assert.ok(result.edges[0]?.explanation.includes("unit could not be compared"));
});

test("lets the model fill a gap code could not compare", async () => {
  const source = assertion({ canonicalNumber: 100, canonicalValue: "100", rawValue: "100" });
  const target = assertion({
    documentId: "doc-b",
    canonicalNumber: 120,
    canonicalValue: "120",
    rawValue: "120",
    // No shared qualifier keys, so scope is unknown to code and the model has to establish it.
    qualifiers: { region: "India" },
  });
  const model = scriptedModel([
    contradictionReply,
    {
      reconcilable: false,
      reasonCode: "missing_context",
      explanation: "No qualifier separates them.",
      confidence: 0.7,
    },
  ]);

  const result = await adjudicatePairs([{ source, target }], model, "test");

  assert.equal(result.edges[0]?.verdict, "contradicts");
  assert.ok(result.edges[0]?.matchedFields.includes("scope"));
});

test("sends every surviving contradiction back with the burden reversed", async () => {
  const source = assertion({ canonicalNumber: 100, canonicalValue: "100", rawValue: "100" });
  const target = assertion({
    documentId: "doc-b",
    canonicalNumber: 120,
    canonicalValue: "120",
    rawValue: "120",
  });
  const model = scriptedModel([
    contradictionReply,
    {
      reconcilable: true,
      reasonCode: "vintage_difference",
      explanation: "The later document restates the figure after an audit adjustment.",
      confidence: 0.85,
    },
  ]);

  const result = await adjudicatePairs([{ source, target }], model, "test");
  const edge = result.edges[0];

  assert.equal(model.calls.length, 2);
  assert.equal(model.calls[1]?.escalate, true, "the second pass is the one escalation condition");
  assert.equal(edge?.verdict, "reconciles");
  assert.equal(edge?.reasonCode, "vintage_difference");
  assert.equal(edge?.priorPass?.verdict, "contradicts");
  assert.equal(edge?.priorPass?.explanation, contradictionReply.explanation);
  assert.equal(result.stats.downgraded, 1);
});

test("keeps a contradiction the review could not defuse, and says so", async () => {
  const source = assertion({ canonicalNumber: 100, canonicalValue: "100", rawValue: "100" });
  const target = assertion({
    documentId: "doc-b",
    canonicalNumber: 120,
    canonicalValue: "120",
    rawValue: "120",
  });
  const model = scriptedModel([
    contradictionReply,
    {
      reconcilable: false,
      reasonCode: "missing_context",
      explanation: "Both cover the same audited year with no restatement noted.",
      confidence: 0.9,
    },
  ]);

  const result = await adjudicatePairs([{ source, target }], model, "test");

  assert.equal(result.edges[0]?.verdict, "contradicts");
  assert.equal(result.edges[0]?.priorPass, null);
  assert.ok(result.edges[0]?.explanation.includes("reversed-burden review"));
  assert.equal(result.stats.reviewed, 1);
  assert.equal(result.stats.downgraded, 0);
});

test("records a pair whose model call kept failing instead of dropping it", async () => {
  const source = assertion({ canonicalNumber: 100, canonicalValue: "100", rawValue: "100" });
  const target = assertion({
    documentId: "doc-b",
    canonicalNumber: 120,
    canonicalValue: "120",
    rawValue: "120",
  });
  const model: AdjudicationModel = {
    async generate() {
      throw new Error("provider unavailable");
    },
  };

  const result = await adjudicatePairs([{ source, target }], model, "test");

  assert.equal(result.edges.length, 0);
  assert.equal(result.stats.skipped, 1);
  assert.equal(result.skipped[0]?.reason, "model_error");
});

test("orders a directional pair so the superseding side comes first", () => {
  const earlier = assertion({
    period: { start: "2022-04-01", end: "2023-03-31", precision: "fiscal_year" },
  });
  const later = assertion({
    documentId: "doc-b",
    period: { start: "2023-04-01", end: "2024-03-31", precision: "fiscal_year" },
  });

  assert.equal(orderPair(earlier, later, "time_supersession").first.id, later.id);
  assert.equal(orderPair(later, earlier, "time_supersession").first.id, later.id);

  const projected = assertion({ modality: "projected" });
  const observed = assertion({ documentId: "doc-b", modality: "observed" });
  assert.equal(orderPair(projected, observed, "projection_vs_actual").first.id, observed.id);

  // A non-directional code still has to land on one row whichever document's run reaches it.
  const a = assertion();
  const b = assertion({ documentId: "doc-b" });
  assert.equal(
    orderPair(a, b, "equivalent_value").first.id,
    orderPair(b, a, "equivalent_value").first.id,
  );
});

test("separates a period difference from a conflict without a model", () => {
  const source = assertion({ canonicalNumber: 100, canonicalValue: "100" });
  const target = assertion({
    documentId: "doc-b",
    canonicalNumber: 120,
    canonicalValue: "120",
    period: { start: "2024-04-01", end: "2025-03-31", precision: "fiscal_year" },
  });

  const comparison = compareAssertions(source, target);

  assert.ok(comparison.mismatched.includes("time"));
  assert.ok(comparison.mismatched.includes("value"));
  assert.equal(comparison.periodsOverlap, false);
  assert.equal(comparison.sameSign, true);
  assert.equal(comparison.settled, null);
});

test("treats overlapping but unequal periods as a difference", () => {
  const year = assertion();
  const quarter = assertion({
    documentId: "doc-b",
    period: { start: "2024-01-01", end: "2024-03-31", precision: "quarter" },
  });

  const comparison = compareAssertions(year, quarter);

  assert.equal(comparison.periodsOverlap, true);
  assert.ok(comparison.mismatched.includes("time"), "a quarter inside a year is not that year");
  assert.equal(comparison.settled, null);
});

test("will not read scopes along different axes as agreement", () => {
  // A segment figure and a national figure are not comparable just because neither contradicts the
  // other's qualifier keys. Code says it cannot tell, so the pair is asked about rather than settled.
  const segment = assertion({ qualifiers: { segment: "Express" } });
  const national = assertion({ documentId: "doc-b", qualifiers: { geography: "India" } });

  const comparison = compareAssertions(segment, national);

  assert.ok(comparison.unknown.includes("scope"));
  assert.ok(!comparison.matched.includes("scope"));
  assert.equal(comparison.settled, null, "an unknown scope is never settled as corroboration");
});

test("settles two unqualified claims, which have no scope to disagree about", () => {
  const source = assertion({ qualifiers: {}, unit: null, valueType: "number" });
  const target = assertion({
    documentId: "doc-b",
    qualifiers: {},
    unit: null,
    valueType: "number",
  });

  assert.equal(compareAssertions(source, target).settled?.verdict, "corroborates");
});

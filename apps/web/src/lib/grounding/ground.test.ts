import assert from "node:assert/strict";
import test from "node:test";

import type { AssertionCandidate } from "@superfact/db/contracts";

import { groundCandidate } from "./ground.ts";

const line = {
  id: "p1l1",
  text: "Revenue for FY2024, year ended 31 March 2024, was ₹81,415.38 million in India.",
};

function candidate(overrides: Partial<AssertionCandidate> = {}): AssertionCandidate {
  return {
    subject: "Revenue",
    predicate: "revenue",
    rawValue: "₹81,415.38 million",
    unit: "INR",
    valueType: "money",
    qualifiers: { fiscal_year: "FY2024" },
    modality: "observed",
    attributedTo: null,
    source: "prose",
    tableContext: null,
    evidence: { quote: line.text, lineIds: [line.id] },
    confidence: 0.9,
    ...overrides,
  };
}

test("publishes only after grounding and normalization pass", () => {
  const result = groundCandidate(candidate(), { text: line.text, lines: [line] });

  assert.equal(result.status, "published");
  assert.equal(result.verified, true);
  assert.equal(result.contextComplete, true);
  assert.equal(result.canonicalValue, "81415380000");
  assert.equal(result.unit, "INR");
  assert.deepEqual(result.period, {
    start: "2023-04-01",
    end: "2024-03-31",
    precision: "fiscal_year",
  });
});

test("takes a table currency from its governing unit line", () => {
  const tableLine = { id: "p1l3", text: "I 81,415.38" };
  const result = groundCandidate(
    candidate({
      rawValue: "I 81,415.38",
      source: "table",
      tableContext: {
        title: "Revenue",
        columnHeader: "FY2024, year ended 31 March 2024",
        rowHeader: "Revenue from operations",
        unitLine: "All amounts in Indian Rupees in million",
        footnotes: [],
      },
      evidence: { quote: tableLine.text, lineIds: [tableLine.id] },
    }),
    { text: tableLine.text, lines: [tableLine] },
  );

  assert.equal(result.status, "published");
  assert.equal(result.canonicalValue, "81415380000");
  assert.equal(result.unit, "INR");
});

test("rejects a table value without its governing headers and unit", () => {
  const tableLine = { id: "p1l7", text: "123" };
  const result = groundCandidate(
    candidate({
      subject: "Unlabelled value",
      predicate: "has value",
      rawValue: "123",
      unit: null,
      valueType: "number",
      qualifiers: {},
      source: "table",
      tableContext: {
        title: null,
        columnHeader: null,
        rowHeader: null,
        unitLine: null,
        footnotes: [],
      },
      evidence: { quote: tableLine.text, lineIds: [tableLine.id] },
    }),
    { text: tableLine.text, lines: [tableLine] },
  );

  assert.equal(result.status, "rejected");
  assert.equal(result.verified, true);
  assert.equal(result.contextComplete, false);
  assert.equal(result.rejectionReason, "missing_context");
  assert.match(result.rejectionDetail ?? "", /table_title/);
  assert.match(result.rejectionDetail ?? "", /table_column_header/);
  assert.match(result.rejectionDetail ?? "", /table_row_header/);
  assert.match(result.rejectionDetail ?? "", /table_unit/);
});

test("accepts a table unit stated directly on the candidate", () => {
  const tableLine = { id: "p1l8", text: "42 employees" };
  const result = groundCandidate(
    candidate({
      subject: "Engineering team",
      predicate: "headcount",
      rawValue: "42",
      unit: "employees",
      valueType: "number",
      qualifiers: {},
      source: "table",
      tableContext: {
        title: "Employee count",
        columnHeader: "2024",
        rowHeader: "Engineering",
        unitLine: null,
        footnotes: [],
      },
      evidence: { quote: tableLine.text, lineIds: [tableLine.id] },
    }),
    { text: tableLine.text, lines: [tableLine] },
  );

  assert.equal(result.status, "published");
  assert.equal(result.contextComplete, true);
});

test("stores a quote failure instead of publishing it", () => {
  const result = groundCandidate(
    candidate({ evidence: { quote: "invented", lineIds: [line.id] } }),
    {
      text: line.text,
      lines: [line],
    },
  );

  assert.equal(result.status, "rejected");
  assert.equal(result.verified, false);
  assert.equal(result.rejectionReason, "quote_not_found");
});

test("stores missing cited lines with a precise reason", () => {
  const result = groundCandidate(
    candidate({ evidence: { quote: line.text, lineIds: ["p1l99"] } }),
    { text: line.text, lines: [line] },
  );

  assert.equal(result.status, "rejected");
  assert.equal(result.rejectionReason, "line_not_found");
});

test("rejects context-sensitive claims that omit their period", () => {
  const result = groundCandidate(candidate({ qualifiers: {} }), {
    text: line.text,
    lines: [line],
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.verified, true);
  assert.equal(result.contextComplete, false);
  assert.equal(result.rejectionReason, "missing_context");
});

test("does not accept a named period key with an unusable value", () => {
  const result = groundCandidate(candidate({ qualifiers: { fiscal_year: "not stated" } }), {
    text: line.text,
    lines: [line],
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.rejectionReason, "missing_context");
});

test("checks numeric signs against the evidence span", () => {
  const percentLine = { id: "p1l2", text: "National growth in 2024 was 12% in India." };
  const result = groundCandidate(
    candidate({
      subject: "National output",
      predicate: "growth",
      rawValue: "-12%",
      unit: "percent",
      valueType: "percent",
      qualifiers: { year: "2024", geography: "India" },
      evidence: { quote: percentLine.text, lineIds: [percentLine.id] },
    }),
    { text: percentLine.text, lines: [percentLine] },
  );

  assert.equal(result.status, "rejected");
  assert.equal(result.rejectionReason, "value_not_in_source");
});

test("rejects a percent claim when the source has no percent marker", () => {
  const percentLine = { id: "p1l4", text: "National growth in 2024 was 12 in India." };
  const result = groundCandidate(
    candidate({
      subject: "National output",
      predicate: "growth",
      rawValue: "12",
      unit: "percent",
      valueType: "percent",
      qualifiers: { year: "2024", geography: "India" },
      evidence: { quote: percentLine.text, lineIds: [percentLine.id] },
    }),
    { text: percentLine.text, lines: [percentLine] },
  );

  assert.equal(result.status, "rejected");
  assert.equal(result.rejectionReason, "value_not_in_source");
});

test("uses the source's fiscal year end instead of assuming a calendar", () => {
  const calendarLine = {
    id: "p1l5",
    text: "Revenue for FY2024, year ended 31 December 2024, was $10 million.",
  };
  const result = groundCandidate(
    candidate({
      rawValue: "$10 million",
      unit: "USD",
      qualifiers: { fiscal_year: "FY2024" },
      evidence: { quote: calendarLine.text, lineIds: [calendarLine.id] },
    }),
    { text: calendarLine.text, lines: [calendarLine] },
  );

  assert.equal(result.status, "published");
  assert.deepEqual(result.period, {
    start: "2024-01-01",
    end: "2024-12-31",
    precision: "fiscal_year",
  });
});

test("normalizes a fiscal period used as the assertion value", () => {
  const fiscalLine = {
    id: "p1l6",
    text: "The reporting period was FY2024, year ended 31 March 2024.",
  };
  const result = groundCandidate(
    candidate({
      subject: "Reporting period",
      predicate: "was",
      rawValue: "FY2024",
      unit: null,
      valueType: "date",
      qualifiers: { fiscal_year: "FY2024" },
      evidence: { quote: fiscalLine.text, lineIds: [fiscalLine.id] },
    }),
    { text: fiscalLine.text, lines: [fiscalLine] },
  );

  assert.equal(result.status, "published");
  assert.equal(result.canonicalValue, "2023-04-01");
  assert.deepEqual(result.period, {
    start: "2023-04-01",
    end: "2024-03-31",
    precision: "fiscal_year",
  });
});

test("accepts a quote whose words are split across parser line fragments", () => {
  // MuPDF hands back a text run per line, so one printed sentence arrives as fragments. The model
  // quotes the sentence; the stored page text joins the fragments with newlines. Both say the same
  // thing and the gate has to see that, or it rejects genuine evidence for a layout artifact.
  const fragments = [
    { id: "p1l1", text: "Fresh" },
    { id: "p1l2", text: "issue of" },
    { id: "p1l3", text: "₹40,000.00 million" },
  ];
  const result = groundCandidate(
    candidate({
      subject: "Fresh issue",
      predicate: "aggregates to",
      rawValue: "₹40,000.00 million",
      unit: "INR",
      qualifiers: { fiscal_year: "FY2024" },
      evidence: {
        quote: "Fresh issue of ₹40,000.00 million",
        lineIds: ["p1l1", "p1l2", "p1l3"],
      },
    }),
    { text: fragments.map((line) => line.text).join("\n"), lines: fragments },
  );

  assert.equal(result.verified, true);
  assert.notEqual(result.rejectionReason, "quote_not_found");
});

test("still refuses a quote whose words are not on the page", () => {
  const fragments = [{ id: "p1l1", text: "Revenue rose" }];
  const result = groundCandidate(
    candidate({ evidence: { quote: "Revenue fell", lineIds: ["p1l1"] } }),
    { text: "Revenue rose", lines: fragments },
  );

  assert.equal(result.status, "rejected");
  assert.equal(result.rejectionReason, "quote_not_found");
});

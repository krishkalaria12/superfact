import assert from "node:assert/strict";
import test from "node:test";

import {
  findFiscalYearEndDay,
  normalizePeriod,
  normalizeValue,
  verifyValueInSource,
} from "./normalize.ts";

function value(
  rawValue: string,
  valueType: "money" | "percent" | "number" | "duration",
  unit?: string,
) {
  const result = normalizeValue({ rawValue, valueType, unit });
  if (!result.ok) throw new Error(result.failure.detail);
  assert.equal(result.ok, true);
  return result.value;
}

function period(raw: string, fiscalYearEnd?: string) {
  const result = normalizePeriod(raw, { fiscalYearEnd });
  if (!result.ok) throw new Error(result.failure.detail);
  assert.equal(result.ok, true);
  return result.value;
}

test("normalizes equivalent Indian currency scales exactly", () => {
  assert.deepEqual(value("₹81,415.38 million", "money"), {
    rawValue: "₹81,415.38 million",
    canonicalValue: "81415380000",
    canonicalNumber: 81_415_380_000,
    unit: "INR",
    normalizationRule: "inr_million_to_inr",
  });
  assert.equal(value("8,141.538 crore", "money", "INR").canonicalValue, "81415380000");
  assert.equal(value("72.25 billion", "money", "INR").canonicalValue, "72250000000");
  assert.equal(value("7,225 crore", "money", "INR").canonicalValue, "72250000000");
});

test("preserves signs and normalizes percentages", () => {
  assert.equal(value("(18%)", "percent").canonicalValue, "-0.18");
  assert.equal(value("1%", "percent").canonicalValue, "0.01");
  assert.equal(value("0.5%", "percent").canonicalValue, "0.005");
  assert.equal(value("−1.25 million", "number").canonicalValue, "-1250000");
  assert.equal(value("+2.5 thousand", "number").canonicalValue, "2500");
});

test("normalizes numeric ranges without inventing a midpoint", () => {
  assert.deepEqual(value("₹10 to 12 million", "money"), {
    rawValue: "₹10 to 12 million",
    canonicalValue: "10000000..12000000",
    canonicalNumber: null,
    unit: "INR",
    normalizationRule: "inr_million_to_inr_range",
  });
});

test("normalizes ordinary units without changing their dimension", () => {
  assert.deepEqual(value("12.5 kilograms", "number"), {
    rawValue: "12.5 kilograms",
    canonicalValue: "12.5",
    canonicalNumber: 12.5,
    unit: "kg",
    normalizationRule: "kg_identity",
  });
  assert.equal(value("18 months", "duration").unit, "month");
});

test("normalizes dates and reporting periods to inclusive bounds", () => {
  assert.deepEqual(period("31 March 2024"), {
    start: "2024-03-31",
    end: "2024-03-31",
    precision: "day",
  });
  assert.deepEqual(period("March 2024"), {
    start: "2024-03-01",
    end: "2024-03-31",
    precision: "month",
  });
  assert.deepEqual(period("2024"), { start: "2024-01-01", end: "2024-12-31", precision: "year" });
  assert.deepEqual(period("FY2024", "2024-03-31"), {
    start: "2023-04-01",
    end: "2024-03-31",
    precision: "fiscal_year",
  });
  assert.deepEqual(period("Q3 FY2024", "2024-03-31"), {
    start: "2023-10-01",
    end: "2023-12-31",
    precision: "quarter",
  });
  assert.deepEqual(period("Q3 2024"), {
    start: "2024-07-01",
    end: "2024-09-30",
    precision: "quarter",
  });
  assert.deepEqual(period("H2 FY2024", "2024-03-31"), {
    start: "2023-10-01",
    end: "2024-03-31",
    precision: "half_year",
  });
  assert.deepEqual(period("2023-2024"), {
    start: "2023-01-01",
    end: "2024-12-31",
    precision: "year",
  });
});

test("verifies value, sign, scale, currency, date, and unit against evidence", () => {
  assert.deepEqual(
    verifyValueInSource({
      rawValue: "81,415.38 million",
      valueType: "money",
      unit: "INR",
      sourceSpan: "Revenue was I 81,415.38 million. All amounts are in Indian Rupees.",
    }),
    { ok: true },
  );
  assert.equal(
    verifyValueInSource({
      rawValue: "2024",
      valueType: "date",
      sourceSpan: "Balance was measured as of 31 March 2024.",
    }).ok,
    false,
  );
  assert.deepEqual(
    verifyValueInSource({
      rawValue: "31 March 2024",
      valueType: "date",
      sourceSpan: "For the year ended 31 March 2024",
    }),
    { ok: true },
  );
  assert.deepEqual(
    verifyValueInSource({
      rawValue: "12 kg",
      valueType: "number",
      sourceSpan: "Net weight was 12 kilograms",
    }),
    { ok: true },
  );

  const wrongSign = verifyValueInSource({
    rawValue: "-12%",
    valueType: "percent",
    sourceSpan: "Growth was 12%.",
  });
  assert.equal(wrongSign.ok, false);
  if (!wrongSign.ok) assert.equal(wrongSign.failure.reason, "value_not_in_source");

  const absentUnit = verifyValueInSource({
    rawValue: "12 kg",
    valueType: "number",
    sourceSpan: "The result was 12 metres.",
  });
  assert.equal(absentUnit.ok, false);
  if (!absentUnit.ok) assert.match(absentUnit.failure.detail, /unit/);
});

test("returns a precise failure for unsupported and invalid periods", () => {
  const result = normalizePeriod("Q5 2024");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.reason, "normalization_failed");
    assert.match(result.failure.detail, /unsupported/);
  }
});

test("dates a fiscal label from the calendar the document states elsewhere", () => {
  const day = findFiscalYearEndDay(
    "Consolidated results for the year ended March 31, 2024. Segment tables follow.",
  );

  assert.deepEqual(day, { month: 3, day: 31 });

  // The same calendar dates a different fiscal year, which is the point of storing month and day
  // rather than the one date the document happened to print.
  const fy22 = normalizePeriod("FY2022", { fiscalYearEndDay: day! });
  assert.equal(fy22.ok, true);
  assert.deepEqual(fy22.ok && fy22.value, {
    start: "2021-04-01",
    end: "2022-03-31",
    precision: "fiscal_year",
  });
});

test("assumes no fiscal calendar when the document never states one", () => {
  assert.equal(findFiscalYearEndDay("Revenue grew in FY24 across every segment."), null);
  assert.equal(normalizePeriod("FY2024").ok, false);
});

test("takes the calendar a document uses most when it names several", () => {
  const day = findFiscalYearEndDay(
    "for the year ended March 31, 2024 ... year ended March 31, 2022 ... period ended December 31, 2023",
  );

  assert.deepEqual(day, { month: 3, day: 31 });
});

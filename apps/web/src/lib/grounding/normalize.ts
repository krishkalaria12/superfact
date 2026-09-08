import type { Period } from "@superfact/db/contracts";
import type { ValueType } from "@superfact/db/schema/assertions";

export type NormalizedValue = {
  rawValue: string;
  canonicalValue: string;
  canonicalNumber: number | null;
  unit: string | null;
  normalizationRule: string;
};

export type NormalizationFailure = {
  reason: "normalization_failed";
  detail: string;
};

export type SourceVerificationFailure = {
  reason: "value_not_in_source";
  detail: string;
};

export type NormalizationResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: NormalizationFailure };

const SCALE_EXPONENTS: Record<string, number> = {
  thousand: 3,
  million: 6,
  billion: 9,
  lakh: 5,
  lac: 5,
  crore: 7,
  cr: 7,
};

const CURRENCY_CODES: Record<string, string> = {
  $: "USD",
  us$: "USD",
  usd: "USD",
  dollar: "USD",
  dollars: "USD",
  "₹": "INR",
  inr: "INR",
  rupee: "INR",
  rupees: "INR",
  rs: "INR",
  "rs.": "INR",
  "£": "GBP",
  gbp: "GBP",
  "€": "EUR",
  eur: "EUR",
  "¥": "JPY",
  jpy: "JPY",
};

const UNIT_ALIASES: Record<string, string> = {
  "%": "percent",
  percent: "percent",
  percentage: "percent",
  kg: "kg",
  kilogram: "kg",
  kilograms: "kg",
  g: "g",
  gram: "g",
  grams: "g",
  km: "km",
  kilometre: "km",
  kilometres: "km",
  kilometer: "km",
  kilometers: "km",
  m: "m",
  metre: "m",
  metres: "m",
  meter: "m",
  meters: "m",
  cm: "cm",
  litre: "L",
  litres: "L",
  liter: "L",
  liters: "L",
  l: "L",
  second: "s",
  seconds: "s",
  minute: "min",
  minutes: "min",
  hour: "h",
  hours: "h",
  day: "day",
  days: "day",
  month: "month",
  months: "month",
  year: "year",
  years: "year",
};

function fail(detail: string): NormalizationResult<never> {
  return { ok: false, failure: { reason: "normalization_failed", detail } };
}

function clean(value: string): string {
  return value.replace(/[\u00a0\u202f]/g, " ").trim();
}

function decimalTimesPower(raw: string, exponent: number): string | null {
  let value = raw.replace(/,/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1).trim();
  }
  if (/^[+−–-]/.test(value)) {
    negative = !value.startsWith("+");
    value = value.slice(1);
  }
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [integer, fraction = ""] = value.split(".");
  const digits = `${integer}${fraction}`;
  const decimalPosition = integer.length + exponent;
  let result =
    decimalPosition <= 0
      ? `0.${"0".repeat(-decimalPosition)}${digits}`
      : decimalPosition >= digits.length
        ? digits + "0".repeat(decimalPosition - digits.length)
        : `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
  result = result.replace(/^0+(?=\d)/, "").replace(/\.0+$|(?<=\.[0-9]*?)0+$/g, "");
  if (result === "") result = "0";
  return negative && result !== "0" ? `-${result}` : result;
}

function detectCurrency(text: string, suppliedUnit?: string | null): string | null {
  const haystack = `${text} ${suppliedUnit ?? ""}`.toLowerCase();
  for (const [alias, code] of Object.entries(CURRENCY_CODES)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (
      new RegExp(alias.length === 1 ? escaped : `(?:^|[^a-z])${escaped}(?=[^a-z]|$)`, "i").test(
        haystack,
      )
    )
      return code;
  }
  return null;
}

function detectScale(text: string): { name: string; exponent: number } {
  const match = text.toLowerCase().match(/\b(thousand|million|billion|lakh|lac|crore|cr)\b/);
  return match
    ? { name: match[1], exponent: SCALE_EXPONENTS[match[1]] }
    : { name: "base", exponent: 0 };
}

function detectUnit(text: string, suppliedUnit?: string | null): string | null {
  const currency = detectCurrency(text, suppliedUnit);
  if (currency) return currency;
  const candidates = `${suppliedUnit ?? ""} ${text}`.toLowerCase().match(/[a-z%]+/g) ?? [];
  for (const candidate of candidates) if (UNIT_ALIASES[candidate]) return UNIT_ALIASES[candidate];
  return suppliedUnit?.trim() || null;
}

function numericToken(text: string): string | null {
  const parenthesized = text.match(/\(\s*([0-9][0-9,]*(?:\.\d+)?)\s*\)/);
  if (parenthesized) return `(${parenthesized[1]})`;
  const ordinary = text.match(/[+−–-]?\s*[0-9][0-9,]*(?:\.\d+)?/)?.[0].replace(/\s/g, "") ?? null;
  return ordinary && /^\s*\(/.test(text) && /\)\s*$/.test(text) ? `(${ordinary})` : ordinary;
}

function numericRangeTokens(text: string): [string, string] | null {
  const match = text.match(
    /([+−–-]?\s*[0-9][0-9,]*(?:\.\d+)?)\s+(?:to|through|[-–—])\s+([+−–-]?\s*[0-9][0-9,]*(?:\.\d+)?)/i,
  );
  return match ? [match[1].replace(/\s/g, ""), match[2].replace(/\s/g, "")] : null;
}

/** Normalizes scalar assertion values without consulting a model. */
export function normalizeValue(input: {
  rawValue: string;
  valueType: ValueType;
  unit?: string | null;
  fiscalYearEnd?: string;
}): NormalizationResult<NormalizedValue> {
  const rawValue = clean(input.rawValue);
  if (!rawValue) return fail("raw value is empty");

  if (input.valueType === "date") {
    const period = normalizePeriod(rawValue, { fiscalYearEnd: input.fiscalYearEnd });
    if (!period.ok) return period;
    return {
      ok: true,
      value: {
        rawValue,
        canonicalValue: period.value.start,
        canonicalNumber: null,
        unit: null,
        normalizationRule: `date_${period.value.precision}_to_iso`,
      },
    };
  }

  if (input.valueType === "text") {
    return {
      ok: true,
      value: {
        rawValue,
        canonicalValue: rawValue.normalize("NFKC").replace(/\s+/g, " "),
        canonicalNumber: null,
        unit: input.unit?.trim() || null,
        normalizationRule: "text_nfkc",
      },
    };
  }

  const range = numericRangeTokens(rawValue);
  if (range) {
    const scale = detectScale(`${rawValue} ${input.unit ?? ""}`);
    const isPercent =
      input.valueType === "percent" ||
      /%|\bpercent(?:age)?\b/i.test(`${rawValue} ${input.unit ?? ""}`);
    const exponent = scale.exponent + (isPercent ? -2 : 0);
    const bounds = range.map((token) => decimalTimesPower(token, exponent));
    if (!bounds[0] || !bounds[1]) return fail(`invalid numeric range ${JSON.stringify(rawValue)}`);
    const currency = detectCurrency(rawValue, input.unit);
    const unit = isPercent ? "percent" : detectUnit(rawValue, input.unit);
    const baseRule = isPercent
      ? scale.name === "base"
        ? "percent_to_ratio"
        : `percent_${scale.name}_to_ratio`
      : currency && scale.name !== "base"
        ? `${currency.toLowerCase()}_${scale.name}_to_${currency.toLowerCase()}`
        : scale.name !== "base"
          ? `${scale.name}_to_base`
          : "number_identity";
    return {
      ok: true,
      value: {
        rawValue,
        canonicalValue: `${bounds[0]}..${bounds[1]}`,
        canonicalNumber: null,
        unit,
        normalizationRule: `${baseRule}_range`,
      },
    };
  }

  const token = numericToken(rawValue);
  if (!token) return fail(`no numeric token found in ${JSON.stringify(rawValue)}`);
  const scale = detectScale(`${rawValue} ${input.unit ?? ""}`);
  const isPercent =
    input.valueType === "percent" ||
    /%|\bpercent(?:age)?\b/i.test(`${rawValue} ${input.unit ?? ""}`);
  const exponent = scale.exponent + (isPercent ? -2 : 0);
  const canonicalValue = decimalTimesPower(token, exponent);
  if (canonicalValue === null) return fail(`invalid numeric token ${JSON.stringify(token)}`);
  const canonicalNumber = Number(canonicalValue);
  if (!Number.isFinite(canonicalNumber))
    return fail("normalized number is outside the supported range");

  const currency = detectCurrency(rawValue, input.unit);
  const unit = isPercent ? "percent" : detectUnit(rawValue, input.unit);
  let normalizationRule: string;
  if (isPercent)
    normalizationRule =
      scale.name === "base" ? "percent_to_ratio" : `percent_${scale.name}_to_ratio`;
  else if (currency && scale.name !== "base")
    normalizationRule = `${currency.toLowerCase()}_${scale.name}_to_${currency.toLowerCase()}`;
  else if (currency) normalizationRule = `${currency.toLowerCase()}_identity`;
  else if (scale.name !== "base") normalizationRule = `${scale.name}_to_base`;
  else normalizationRule = unit ? `${unit.toLowerCase()}_identity` : "number_identity";

  return {
    ok: true,
    value: { rawValue, canonicalValue, canonicalNumber, unit, normalizationRule },
  };
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function iso(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validDate(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= lastDay(year, month);
}

/** The twelve months ending on `end`, inclusive at both ends. */
function boundsEndingAt(end: string): { start: string; end: string } {
  const start = new Date(`${end}T00:00:00Z`);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  start.setUTCDate(start.getUTCDate() + 1);
  return { start: start.toISOString().slice(0, 10), end };
}

/**
 * The fiscal calendar a document states about itself, or null when it never says.
 *
 * Searched over the document's whole text rather than the span an assertion cites, because a filing
 * declares its year end once — on a cover page, in a header, in a note — and then writes "FY24" a
 * hundred times. Refusing to date those hundred because the declaration is on another page rejected
 * half of a real document's candidates; reading it from the document is the same move the parser
 * already makes when it takes a table's unit from the governing header rather than the cell.
 *
 * Nothing is assumed. A document that never states a year end still gets no fiscal dates.
 */
export function findFiscalYearEndDay(text: string): FiscalYearEndDay | null {
  const pattern =
    /\b(?:year|period)\s+ende[dr](?:\s+on)?\s+((?:\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+,?\s+\d{4})|(?:[A-Za-z]+\s+\d{1,2},?\s+\d{4})|(?:\d{4}-\d{2}-\d{2}))/gi;

  const seen = new Map<string, number>();
  for (const match of clean(text).matchAll(pattern)) {
    const parsed = normalizePeriod(match[1]!);
    if (!parsed.ok || parsed.value.precision !== "day") continue;
    const key = parsed.value.end.slice(5);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  // A document may mention several year ends; the calendar is the one it uses most.
  const [best] = [...seen.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!best) return null;

  const [month, day] = best[0].split("-").map(Number);
  return month && day ? { month, day } : null;
}

/**
 * The month and day a document's financial year ends on, with no year attached.
 *
 * A fiscal calendar is a month and a day; only the year moves. Reading "year ended March 31, 2024"
 * off a document therefore also tells you when its FY2022 ended, which is what lets one statement
 * anywhere in the document date every fiscal label in it.
 */
export type FiscalYearEndDay = { month: number; day: number };

/** Converts an explicit date or named reporting period to inclusive ISO bounds. */
export function normalizePeriod(
  raw: string,
  options: { fiscalYearEnd?: string; fiscalYearEndDay?: FiscalYearEndDay } = {},
): NormalizationResult<Period> {
  const value = clean(raw);
  let match: RegExpMatchArray | null;

  const fiscalBounds = (endYear: number) => {
    // The document's own calendar, applied to whichever year the label names. Falls back to an
    // explicit year-end date when the two disagree about the year.
    const day = options.fiscalYearEndDay;
    const explicit =
      options.fiscalYearEnd ??
      (day && validDate(endYear, day.month, day.day)
        ? iso(endYear, day.month, day.day)
        : undefined);
    if (!explicit) return null;

    const end = normalizePeriod(explicit);
    if (!end.ok || end.value.precision !== "day" || Number(end.value.end.slice(0, 4)) !== endYear) {
      if (!day || !validDate(endYear, day.month, day.day)) return null;
      const synthesized = normalizePeriod(iso(endYear, day.month, day.day));
      if (!synthesized.ok) return null;
      return boundsEndingAt(synthesized.value.end);
    }
    return boundsEndingAt(end.value.end);
  };

  match = value.match(/^(?:fy|fiscal\s+year)\s*['’]?(\d{2}|\d{4})(?:\s*[-/]\s*(\d{2}|\d{4}))?$/i);
  if (match) {
    const first = Number(match[1]);
    const firstYear = first < 100 ? 2000 + first : first;
    const endYear = match[2]
      ? Number(match[2]) < 100
        ? Math.floor(firstYear / 100) * 100 + Number(match[2])
        : Number(match[2])
      : firstYear;
    if (endYear < firstYear || endYear > firstYear + 1)
      return fail("fiscal year range must cover one reporting year");
    const bounds = fiscalBounds(endYear);
    if (!bounds) return fail("fiscal year requires an explicit matching year-end date");
    return {
      ok: true,
      value: { ...bounds, precision: "fiscal_year" },
    };
  }

  match = value.match(
    /^(?:q([1-4])\s*fy\s*['’]?(\d{2}|\d{4})|fy\s*['’]?(\d{2}|\d{4})\s*q([1-4]))$/i,
  );
  if (match) {
    const quarter = Number(match[1] ?? match[4]);
    const shortYear = Number(match[2] ?? match[3]);
    const fiscalEndYear = shortYear < 100 ? 2000 + shortYear : shortYear;
    const bounds = fiscalBounds(fiscalEndYear);
    if (!bounds) return fail("fiscal quarter requires an explicit matching fiscal year-end date");
    const start = new Date(`${bounds.start}T00:00:00Z`);
    start.setUTCMonth(start.getUTCMonth() + (quarter - 1) * 3);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 3);
    end.setUTCDate(end.getUTCDate() - 1);
    return {
      ok: true,
      value: {
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
        precision: "quarter",
      },
    };
  }

  match = value.match(/^(?:h([12])\s*fy\s*['’]?(\d{2}|\d{4})|fy\s*['’]?(\d{2}|\d{4})\s*h([12]))$/i);
  if (match) {
    const half = Number(match[1] ?? match[4]);
    const shortYear = Number(match[2] ?? match[3]);
    const fiscalEndYear = shortYear < 100 ? 2000 + shortYear : shortYear;
    const bounds = fiscalBounds(fiscalEndYear);
    if (!bounds) return fail("fiscal half-year requires an explicit matching fiscal year-end date");
    const start = new Date(`${bounds.start}T00:00:00Z`);
    start.setUTCMonth(start.getUTCMonth() + (half - 1) * 6);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 6);
    end.setUTCDate(end.getUTCDate() - 1);
    return {
      ok: true,
      value: {
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
        precision: "half_year",
      },
    };
  }

  match = value.match(/^(?:h([12])\s*(\d{4})|(\d{4})\s*h([12]))$/i);
  if (match) {
    const half = Number(match[1] ?? match[4]);
    const year = Number(match[2] ?? match[3]);
    return half === 1
      ? {
          ok: true,
          value: { start: iso(year, 1, 1), end: iso(year, 6, 30), precision: "half_year" },
        }
      : {
          ok: true,
          value: { start: iso(year, 7, 1), end: iso(year, 12, 31), precision: "half_year" },
        };
  }

  match = value.match(/^(?:q([1-4])\s*(\d{4})|(\d{4})\s*q([1-4]))$/i);
  if (match) {
    const quarter = Number(match[1] ?? match[4]);
    const year = Number(match[2] ?? match[3]);
    const month = (quarter - 1) * 3 + 1;
    return {
      ok: true,
      value: {
        start: iso(year, month, 1),
        end: iso(year, month + 2, lastDay(year, month + 2)),
        precision: "quarter",
      },
    };
  }

  match = value.match(/^(\d{4})$/);
  if (match)
    return {
      ok: true,
      value: {
        start: iso(Number(match[1]), 1, 1),
        end: iso(Number(match[1]), 12, 31),
        precision: "year",
      },
    };

  match = value.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = match[3] ? Number(match[3]) : null;
    if (!validDate(year, month, day ?? 1)) return fail(`invalid date ${JSON.stringify(value)}`);
    return day
      ? {
          ok: true,
          value: { start: iso(year, month, day), end: iso(year, month, day), precision: "day" },
        }
      : {
          ok: true,
          value: {
            start: iso(year, month, 1),
            end: iso(year, month, lastDay(year, month)),
            precision: "month",
          },
        };
  }

  match =
    value.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i) ??
    value.match(/^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (match) {
    const monthFirst = Number.isNaN(Number(match[1]));
    const day = Number(monthFirst ? match[2] : match[1]);
    const month = MONTHS[(monthFirst ? match[1] : match[2]).toLowerCase()];
    const year = Number(match[3]);
    if (!month || !validDate(year, month, day))
      return fail(`invalid date ${JSON.stringify(value)}`);
    return {
      ok: true,
      value: { start: iso(year, month, day), end: iso(year, month, day), precision: "day" },
    };
  }

  match = value.match(/^([a-z]+)\s+(\d{4})$/i);
  if (match) {
    const month = MONTHS[match[1].toLowerCase()];
    const year = Number(match[2]);
    if (!month) return fail(`unknown month in ${JSON.stringify(value)}`);
    return {
      ok: true,
      value: {
        start: iso(year, month, 1),
        end: iso(year, month, lastDay(year, month)),
        precision: "month",
      },
    };
  }

  const yearRange = value.match(/^(\d{4})\s*[-–—/]\s*(\d{2}|\d{4})$/);
  if (yearRange) {
    const first = Number(yearRange[1]);
    const secondRaw = Number(yearRange[2]);
    const second = secondRaw < 100 ? Math.floor(first / 100) * 100 + secondRaw : secondRaw;
    if (second < first) return fail("period range ends before it starts");
    return {
      ok: true,
      value: { start: iso(first, 1, 1), end: iso(second, 12, 31), precision: "year" },
    };
  }

  const range = value.match(/^(.+?)\s+(?:to|through|–|—)\s+(.+)$/i);
  if (range) {
    const start = normalizePeriod(range[1]);
    const end = normalizePeriod(range[2]);
    if (!start.ok || !end.ok)
      return fail(`could not normalize both ends of range ${JSON.stringify(value)}`);
    if (start.value.start > end.value.end) return fail("period range ends before it starts");
    return {
      ok: true,
      value: {
        start: start.value.start,
        end: end.value.end,
        precision: start.value.precision === end.value.precision ? start.value.precision : "day",
      },
    };
  }

  return fail(`unsupported date or period ${JSON.stringify(value)}`);
}

/** Checks the claimed scalar's source-sensitive tokens against the complete evidence span. */
export function verifyValueInSource(input: {
  rawValue: string;
  valueType: ValueType;
  unit?: string | null;
  fiscalYearEnd?: string;
  sourceSpan: string;
}): { ok: true } | { ok: false; failure: SourceVerificationFailure } {
  const source = clean(input.sourceSpan);
  const normalized = normalizeValue(input);
  if (!normalized.ok)
    return {
      ok: false,
      failure: { reason: "value_not_in_source", detail: normalized.failure.detail },
    };

  if (input.valueType === "date") {
    const expected = normalizePeriod(input.rawValue, { fiscalYearEnd: input.fiscalYearEnd });
    if (!expected.ok)
      return {
        ok: false,
        failure: { reason: "value_not_in_source", detail: expected.failure.detail },
      };
    const candidates = dateCandidates(source);
    if (
      /\bfy|fiscal\s+year/i.test(input.rawValue) &&
      source.includes(clean(input.rawValue)) &&
      candidates.some(
        (candidate) => candidate.precision === "day" && candidate.end === input.fiscalYearEnd,
      )
    ) {
      return { ok: true };
    }
    if (
      !candidates.some(
        (candidate) =>
          candidate.start === expected.value.start && candidate.end === expected.value.end,
      )
    ) {
      return {
        ok: false,
        failure: {
          reason: "value_not_in_source",
          detail: `date or period ${JSON.stringify(input.rawValue)} does not occur in the evidence span`,
        },
      };
    }
    return { ok: true };
  }

  if (input.valueType !== "text") {
    const expected = normalized.value.canonicalValue;
    if (input.valueType === "percent" && !/%|\bpercent(?:age)?\b/i.test(source)) {
      return {
        ok: false,
        failure: {
          reason: "value_not_in_source",
          detail: "the evidence span does not identify the value as a percentage",
        },
      };
    }
    const fragments =
      source.match(
        /(?:\(|[+−–-])?\s*[₹$£€¥]?\s*[0-9][0-9,]*(?:\.\d+)?\s*\)?(?:\s*(?:%|percent|thousand|million|billion|lakh|lac|crore|cr))?/gi,
      ) ?? [];
    const found = expected.includes("..")
      ? source.includes(clean(input.rawValue))
      : fragments.some((fragment) => {
          const result = normalizeValue({
            rawValue: fragment,
            valueType: input.valueType,
            unit: input.unit,
          });
          return result.ok && result.value.canonicalValue === expected;
        });
    if (!found)
      return {
        ok: false,
        failure: {
          reason: "value_not_in_source",
          detail: `numeric value ${JSON.stringify(input.rawValue)} does not occur with the same sign and scale in the evidence span`,
        },
      };
  } else if (!source.includes(clean(input.rawValue))) {
    return {
      ok: false,
      failure: {
        reason: "value_not_in_source",
        detail: `text value ${JSON.stringify(input.rawValue)} does not occur in the evidence span`,
      },
    };
  }

  const rawCurrency = detectCurrency(input.rawValue, null);
  const claimedCurrency = rawCurrency ?? detectCurrency("", input.unit);
  if (claimedCurrency && detectCurrency(source, null) !== claimedCurrency) {
    return {
      ok: false,
      failure: {
        reason: "value_not_in_source",
        detail: `currency ${claimedCurrency} is absent from the evidence span`,
      },
    };
  }
  const claimedUnit = detectUnit(input.rawValue, input.unit);
  if (
    !claimedCurrency &&
    claimedUnit &&
    claimedUnit !== "percent" &&
    detectUnit(source, null) !== claimedUnit
  ) {
    return {
      ok: false,
      failure: {
        reason: "value_not_in_source",
        detail: `unit ${JSON.stringify(claimedUnit)} is absent from the evidence span`,
      },
    };
  }
  return { ok: true };
}

function dateCandidates(source: string): Period[] {
  const patterns = [
    /\b(?:FY|fiscal\s+year)\s*['’]?\d{2,4}(?:\s*[-/]\s*\d{2,4})?\b/gi,
    /\b(?:Q[1-4]\s*(?:FY)?\s*['’]?\d{2,4}|(?:FY)?\s*['’]?\d{2,4}\s*Q[1-4])\b/gi,
    /\b(?:H[12]\s*(?:FY)?\s*['’]?\d{2,4}|(?:FY)?\s*['’]?\d{2,4}\s*H[12])\b/gi,
    /\b\d{4}-\d{2}(?:-\d{2})?\b/g,
    /\b\d{1,2}\s+[A-Za-z]+\s+\d{4}\b/g,
    /\b[A-Za-z]+\s+\d{1,2},?\s+\d{4}\b/g,
    /\b[A-Za-z]+\s+\d{4}\b/g,
    /\b\d{4}\b/g,
  ];
  const periods: Period[] = [];
  const occupied: Array<{ start: number; end: number }> = [];
  for (const pattern of patterns)
    for (const match of source.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (occupied.some((span) => start < span.end && end > span.start)) continue;
      const result = normalizePeriod(match[0]);
      if (result.ok) periods.push(result.value);
      if (result.ok) occupied.push({ start, end });
    }
  return periods;
}

/** Returns the first explicit date or reporting period in a larger piece of source text. */
export function findPeriodInSource(source: string): Period | null {
  return dateCandidates(clean(source))[0] ?? null;
}

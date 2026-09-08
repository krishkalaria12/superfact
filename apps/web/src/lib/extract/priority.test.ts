import assert from "node:assert/strict";
import test from "node:test";

import { pagePriority, planExtractionBatches, type PagePriorityInput } from "./priority.ts";

function line(text: string, size = 10) {
  return { text, size };
}

function table(cells: number, title: string | null = "Revenue by segment") {
  return {
    quality: "clean" as const,
    title,
    rows: Array.from({ length: Math.ceil(cells / 4) }, () => ({
      cells: Array.from({ length: 4 }, () => ({})),
    })),
  } as unknown as PagePriorityInput["tables"][number];
}

function page(pageNumber: number, overrides: Partial<PagePriorityInput> = {}): PagePriorityInput {
  return {
    pageNumber,
    lines: [line("Ordinary body prose that runs on for a while.")],
    tables: [],
    ...overrides,
  };
}

test("ranks a table page ahead of a prose page", () => {
  const tables = pagePriority(page(9, { tables: [table(80)] }));
  const prose = pagePriority(page(2, { lines: [line("x".repeat(1500))] }));

  assert.ok(tables > prose, "a reconstructed table is the densest fact source a page can have");
});

test("ranks a summary heading ahead of ordinary prose of the same length", () => {
  const body = "y".repeat(1200);
  const summary = pagePriority(page(4, { lines: [line("Financial Highlights", 16), line(body)] }));
  const ordinary = pagePriority(
    page(5, { lines: [line("Notes to the accounts", 16), line(body)] }),
  );

  assert.ok(summary > ordinary);
});

test("ignores a ragged table, which emits no rows to extract from", () => {
  const ragged = {
    quality: "ragged" as const,
    title: "Revenue",
    rows: [],
  } as unknown as PagePriorityInput["tables"][number];

  assert.equal(pagePriority(page(3, { tables: [ragged], lines: [] })), 0);
});

test("puts an empty page last", () => {
  assert.equal(pagePriority(page(1, { lines: [], tables: [] })), 0);
});

test("batches the densest pages first, wherever they sit in the document", () => {
  const pages = [
    page(1, { lines: [line("Cover page")] }),
    page(2, { lines: [line("Table of contents")] }),
    page(3, { lines: [line("Body prose")] }),
    page(40, { tables: [table(120)] }),
    page(41, { tables: [table(120)] }),
  ];

  const batches = planExtractionBatches(pages, 2);

  assert.deepEqual(batches[0], [40, 41], "the tables run before the front matter");
  assert.equal(batches.flat().length, 5, "ordering changes, the set never does");
  assert.deepEqual(
    batches.flat().sort((a, b) => a - b),
    [1, 2, 3, 40, 41],
  );
});

test("plans the same batches every time it sees the same document", () => {
  const pages = [page(3), page(1), page(2)];

  assert.deepEqual(planExtractionBatches(pages, 2), planExtractionBatches(pages, 2));
  // Every page here scores identically, so page order is the only tiebreak left.
  assert.deepEqual(planExtractionBatches(pages, 2)[0], [1, 2]);
});

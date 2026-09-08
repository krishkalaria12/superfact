import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedLine } from "@superfact/db/contracts";

import { reconstructTables } from "./tables.ts";

let nextLine = 1;

function line(text: string, x0: number, x1: number, y: number, size = 10): ParsedLine {
  return { id: `p1l${nextLine++}`, text, bbox: { x0, y0: y, x1, y1: y + 8 }, size };
}

test("starts a new table when a heading grid follows earlier body rows", () => {
  nextLine = 1;
  const lines = [
    line("Selected indicators", 0, 360, 0, 14),
    line("Population", 0, 80, 20),
    line("100", 100, 120, 20),
    line("Poverty", 200, 280, 20),
    line("5.3", 300, 320, 20),
    line("Households", 0, 80, 30),
    line("80", 100, 120, 30),
    line("Undernourished", 200, 280, 30),
    line("13.7", 300, 320, 30),
    line("Urban population", 0, 80, 40),
    line("36.4", 100, 120, 40),
    line("Gini index", 200, 280, 40),
    line("25.5", 300, 320, 40),
    line("Economic indicators", 80, 220, 55, 12),
    line("2021/22", 100, 130, 70),
    line("2022/23", 150, 180, 70),
    line("2023/24", 200, 230, 70),
    line("2024/25", 250, 280, 70),
    line("2025/26", 300, 330, 70),
    line("2026/27", 350, 380, 70),
    line("Real GDP", 0, 80, 85),
    line("9.7", 110, 120, 85),
    line("7.6", 160, 170, 85),
    line("9.2", 210, 220, 85),
    line("6.5", 260, 270, 85),
    line("6.6", 310, 320, 85),
    line("6.2", 360, 370, 85),
    line("Consumer prices", 0, 80, 95),
    line("5.5", 110, 120, 95),
    line("6.7", 160, 170, 95),
    line("5.4", 210, 220, 95),
    line("4.6", 260, 270, 95),
    line("4.2", 310, 320, 95),
    line("4.1", 360, 370, 95),
    line("Fiscal balance", 0, 80, 105),
    line("-6.7", 110, 120, 105),
    line("-6.5", 160, 170, 105),
    line("-5.5", 210, 220, 105),
    line("-4.9", 260, 270, 105),
    line("-4.4", 310, 320, 105),
    line("-4.4", 360, 370, 105),
  ];

  const tables = reconstructTables(lines, [{ index: 0, x0: 0, x1: 400 }], 1);

  assert.equal(tables.length, 2);
  assert.deepEqual(tables[1]?.columnHeaders.slice(1), [
    "2021/22",
    "2022/23",
    "2023/24",
    "2024/25",
    "2025/26",
    "2026/27",
  ]);
  assert.equal(tables[1]?.rows[0]?.cells[4]?.text, "6.5");
  assert.equal(tables[1]?.columnHeaders[tables[1]!.rows[0]!.cells[4]!.column], "2024/25");
});

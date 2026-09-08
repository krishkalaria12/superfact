import { assertions, db, pages } from "@superfact/db";
import { eq, inArray } from "@superfact/db/orm";

function collapseWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

const assertionRows = await db
  .select({
    id: assertions.id,
    documentId: assertions.documentId,
    pageId: assertions.pageId,
    pageNumber: assertions.pageNumber,
    quote: assertions.evidenceQuote,
    lineIds: assertions.evidenceLineIds,
    verified: assertions.verified,
    contextComplete: assertions.contextComplete,
    source: assertions.source,
    unit: assertions.unit,
    tableContext: assertions.tableContext,
  })
  .from(assertions)
  .where(eq(assertions.status, "published"));

const pageIds = [...new Set(assertionRows.map((row) => row.pageId))];
const pageById = new Map<string, { text: string; lines: (typeof pages.$inferSelect)["lines"] }>();
for (let offset = 0; offset < pageIds.length; offset += 10) {
  const pageRows = await db
    .select({ id: pages.id, text: pages.text, lines: pages.lines })
    .from(pages)
    .where(inArray(pages.id, pageIds.slice(offset, offset + 10)));
  for (const page of pageRows) pageById.set(page.id, { text: page.text, lines: page.lines });
}

const failures: { id: string; documentId: string; page: number; reasons: string[] }[] = [];
for (const row of assertionRows) {
  const reasons: string[] = [];
  const page = pageById.get(row.pageId);
  if (!page) reasons.push("parsed page is missing");
  const pageLineIds = new Set(page?.lines.map((line) => line.id) ?? []);
  const missingLines = row.lineIds.filter((lineId) => !pageLineIds.has(lineId));

  if (!row.verified) reasons.push("verified is false");
  if (!row.contextComplete) reasons.push("contextComplete is false");
  if (missingLines.length > 0) reasons.push(`missing line ids: ${missingLines.join(", ")}`);
  if (!collapseWhitespace(page?.text ?? "").includes(collapseWhitespace(row.quote))) {
    reasons.push("quote is not present in page text");
  }

  if (row.source === "table") {
    const context = row.tableContext;
    if (!context?.title?.trim()) reasons.push("table title is missing");
    if (!context?.columnHeader?.trim()) reasons.push("table column header is missing");
    if (!context?.rowHeader?.trim()) reasons.push("table row header is missing");
    if (!context?.unitLine?.trim() && !row.unit?.trim()) reasons.push("table unit is missing");
  }

  if (reasons.length > 0) {
    failures.push({
      id: row.id,
      documentId: row.documentId,
      page: row.pageNumber,
      reasons,
    });
  }
}

console.info(
  JSON.stringify(
    {
      publishedChecked: assertionRows.length,
      failures: failures.length,
      reasons: Object.fromEntries(
        [...new Set(failures.flatMap((failure) => failure.reasons))]
          .sort()
          .map((reason) => [
            reason,
            failures.filter((failure) => failure.reasons.includes(reason)).length,
          ]),
      ),
      examples: failures.slice(0, 20),
    },
    null,
    2,
  ),
);

if (failures.length > 0) process.exitCode = 1;

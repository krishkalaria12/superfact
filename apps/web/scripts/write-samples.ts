import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { assertions, db, documents, pages } from "@superfact/db";
import { and, count, desc, eq, isNotNull } from "@superfact/db/orm";

import { buildDemoCases } from "../src/lib/cases.ts";
import { buildExport } from "../src/lib/export.ts";

/**
 * Writes `samples/` from a real run, so a reviewer without credentials can read the output.
 *
 * The page images are the ones the evidence viewer draws on, downloaded from storage at the scale
 * recorded on their rows. A sample that did not come out of an actual run would defeat the point.
 */

const OUT = join(process.cwd(), "..", "..", "samples");

async function write(relative: string, body: string | Uint8Array) {
  const path = join(OUT, relative);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
  return relative;
}

// Scoped to one document rather than the corpus. A full export runs to megabytes of JSON, which is
// a worse artifact than a complete, readable export of one document: the shape is identical and a
// reviewer can actually open it.
const [smallest] = await db
  .select()
  .from(documents)
  .where(eq(documents.status, "ready"))
  .orderBy(documents.pageCount)
  .limit(1);

if (!smallest) throw new Error("no processed document to export; run the pipeline first");

const runExport = await buildExport(smallest.id);
await write("export.json", JSON.stringify(runExport, null, 2));
console.info(
  `export.json (${smallest.filename}): ${runExport.facts.length} facts, ` +
    `${runExport.edges.length} edges, ${runExport.failures.assertions.length} refused assertions`,
);

await write("cases.json", JSON.stringify(await buildDemoCases(), null, 2));
console.info("cases.json written");

// One page image per document: the page carrying the most published facts, which is the page a
// reviewer would open first.
const documentRows = await db.select().from(documents).where(eq(documents.status, "ready"));
for (const document of documentRows) {
  const [busiest] = await db
    .select({ pageNumber: assertions.pageNumber, n: count() })
    .from(assertions)
    .where(and(eq(assertions.documentId, document.id), eq(assertions.status, "published")))
    .groupBy(assertions.pageNumber)
    .orderBy(desc(count()))
    .limit(1);
  if (!busiest) continue;

  const [page] = await db
    .select()
    .from(pages)
    .where(
      and(
        eq(pages.documentId, document.id),
        eq(pages.pageNumber, busiest.pageNumber),
        isNotNull(pages.rasterUrl),
      ),
    );
  if (!page?.rasterUrl) continue;

  const response = await fetch(page.rasterUrl);
  if (!response.ok) {
    console.warn(`could not fetch raster for ${document.filename} p${page.pageNumber}`);
    continue;
  }

  const slug = document.filename.replace(/\.pdf$/i, "").replace(/[^a-z0-9]+/gi, "-");
  const written = await write(
    `pages/${slug}-p${page.pageNumber}.png`,
    new Uint8Array(await response.arrayBuffer()),
  );
  console.info(`${written} — ${busiest.n} facts, raster scale ${page.rasterScale}`);
}

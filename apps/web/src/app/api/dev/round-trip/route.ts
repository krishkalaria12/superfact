import { assertions, db, documents, edges, pages } from "@superfact/db";
import { runExportSchema } from "@superfact/db/contracts";
import { eq } from "@superfact/db/orm";
import {
  buildRunExport,
  toAssertionRow,
  toClaimEdge,
  toDocumentSummary,
  toEdgeRow,
  toPublishedAssertion,
  toRejectedAssertion,
} from "@superfact/db/projection";
import { env } from "@superfact/env/server";

import { deepDiff } from "@/lib/deep-diff";
import { createError, useLogger, withEvlog } from "@/lib/evlog";
import { fixtureAssertions, fixtureEdge, fixturePage } from "@/lib/fixtures/round-trip";
import { PIPELINE_VERSION } from "@/lib/pipeline";

/**
 * The phase 01 exit check, as an endpoint.
 *
 * It writes hand-written assertions and an edge through the same projection the pipeline will use,
 * reads them back, projects them into the JSON export, validates that against the export contract,
 * and diffs the result against what went in. A dropped column, a lossy type, or a field the
 * contract forgot shows up here as a named path rather than as a hole in an export months later.
 *
 * Everything it writes is deleted before it returns, and the fixture document is invented, so
 * running it leaves no trace and encodes nothing about any real PDF.
 */

const FIXTURE_HASH = "roundtrip-fixture-0000000000000000000000000000000000000000000000000000";

function refuseInProduction() {
  if (env.NODE_ENV === "production") {
    throw createError({
      status: 404,
      message: "Not found",
      why: "The round-trip check exists only to exercise the domain model locally",
      fix: "Run it against a development database",
    });
  }
}

export const POST = withEvlog(async () => {
  refuseInProduction();

  // A previous run that died mid-way would leave the fixture behind; the hash is unique.
  await db.delete(documents).where(eq(documents.contentHash, FIXTURE_HASH));

  const [document] = await db
    .insert(documents)
    .values({
      contentHash: FIXTURE_HASH,
      filename: "round-trip-fixture.pdf",
      byteSize: 1024,
      pageCount: 1,
      storageKey: "fixture/round-trip",
      storageUrl: "https://example.invalid/fixture/round-trip",
      status: "ready",
      pipelineVersion: PIPELINE_VERSION,
    })
    .returning();

  if (!document) {
    throw createError({ status: 500, message: "Could not create the fixture document" });
  }

  try {
    const [page] = await db
      .insert(pages)
      .values({
        documentId: document.id,
        pageNumber: fixturePage.pageNumber,
        width: fixturePage.width,
        height: fixturePage.height,
        text: fixturePage.text,
        lines: fixturePage.lines,
        quality: fixturePage.quality,
        status: "parsed",
      })
      .returning();

    if (!page) {
      throw createError({ status: 500, message: "Could not create the fixture page" });
    }

    const written = fixtureAssertions(document.id, [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ]);
    const writtenEdge = fixtureEdge(crypto.randomUUID(), written.inMillions.id, written.inCrore.id);

    await db
      .insert(assertions)
      .values(
        [written.inMillions, written.inCrore, written.noPeriod].map((a) =>
          toAssertionRow(a, page.id),
        ),
      );
    await db.insert(edges).values(toEdgeRow(writtenEdge));

    // Read back through the ordinary query path, not from what was just inserted.
    const storedAssertions = await db
      .select()
      .from(assertions)
      .where(eq(assertions.documentId, document.id));
    const storedEdges = await db
      .select()
      .from(edges)
      .where(eq(edges.sourceAssertionId, written.inMillions.id));

    const byId = new Map(storedAssertions.map((row) => [row.id, row]));
    const read = (id: string) => {
      const row = byId.get(id);
      if (!row) throw createError({ status: 500, message: `assertion ${id} did not come back` });
      return row;
    };

    const runExport = buildRunExport({
      pipelineVersion: PIPELINE_VERSION,
      documents: [toDocumentSummary(document, { pagesParsed: 1, pagesFailed: 0 })],
      facts: [written.inMillions.id, written.inCrore.id].map((id) =>
        toPublishedAssertion(read(id)),
      ),
      edges: storedEdges.map(toClaimEdge),
      failures: {
        documents: [],
        pages: [],
        assertions: [toRejectedAssertion(read(written.noPeriod.id))],
      },
    });

    const parsed = runExportSchema.safeParse(runExport);

    const differences = [
      ...deepDiff(written.inMillions, runExport.facts[0], "facts[0]"),
      ...deepDiff(written.inCrore, runExport.facts[1], "facts[1]"),
      ...deepDiff(written.noPeriod, runExport.failures.assertions[0], "failures.assertions[0]"),
      ...deepDiff(writtenEdge, runExport.edges[0], "edges[0]"),
    ];

    const ok = differences.length === 0 && parsed.success;

    const contractErrors = parsed.success ? [] : parsed.error.issues.map((i) => i.path.join("."));

    const log = useLogger();
    log.set({
      check: { name: "phase-01-round-trip", ok, differences: [...differences, ...contractErrors] },
    });
    log.info(ok ? "round-trip clean" : "round-trip lost fields");

    return Response.json(
      {
        ok,
        differences,
        contractErrors: parsed.success ? [] : parsed.error.issues,
        export: runExport,
      },
      { status: ok ? 200 : 500 },
    );
  } finally {
    // Pages, assertions, and edges cascade from the document.
    await db.delete(documents).where(eq(documents.id, document.id));
  }
});

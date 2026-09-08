import { assertions, db, pages } from "@superfact/db";
import type { NewAssertion } from "@superfact/db";
import { unionBbox } from "@superfact/db/contracts";
import { and, asc, eq, inArray, ne } from "@superfact/db/orm";

import { useLogger } from "@/lib/evlog";
import { extractAssertionCandidates } from "@/lib/extract";
import { extractionModel } from "@/lib/extraction-model";
import { groundCandidate } from "@/lib/grounding";
import { extractionBatchRequested, inngest } from "../client";

const INSERT_CHUNK = 100;

export const extractPageBatch = inngest.createFunction(
  {
    id: "extract-page-batch",
    triggers: [extractionBatchRequested],
    retries: 2,
    // Multiplied by MODEL_CONCURRENCY inside the extractor, this is what the provider sees.
    concurrency: { limit: 3 },
  },
  async ({ attempt, event, step }) => {
    const { jobId, documentId, pipelineVersion, pageNumbers } = event.data;

    return step.run("extract", async () => {
      const startedAt = Date.now();
      const parsedPages = await db
        .select()
        .from(pages)
        .where(
          and(
            eq(pages.documentId, documentId),
            eq(pages.status, "parsed"),
            inArray(pages.pageNumber, pageNumbers),
          ),
        )
        .orderBy(asc(pages.pageNumber));

      const corpus = await db
        .select({
          documentId: assertions.documentId,
          subject: assertions.subject,
          predicate: assertions.predicate,
          rawValue: assertions.rawValue,
          unit: assertions.unit,
        })
        .from(assertions)
        .where(
          and(
            ne(assertions.documentId, documentId),
            eq(assertions.pipelineVersion, pipelineVersion),
          ),
        );

      // A child invocation may fail after writing one insert chunk. Clearing only these pages makes
      // its retry idempotent without disturbing sibling batches that already completed.
      if (parsedPages.length > 0) {
        await db.delete(assertions).where(
          and(
            eq(assertions.documentId, documentId),
            eq(assertions.pipelineVersion, pipelineVersion),
            inArray(
              assertions.pageId,
              parsedPages.map((page) => page.id),
            ),
          ),
        );
      }

      const result = await extractAssertionCandidates(
        parsedPages.map((page) => ({
          documentId,
          pageNumber: page.pageNumber,
          lines: page.lines,
          tables: page.tables,
        })),
        extractionModel,
        { repetitionCorpus: corpus },
      );

      const pageByLineId = new Map(
        parsedPages.flatMap((page) => page.lines.map((line) => [line.id, page] as const)),
      );
      const rows: NewAssertion[] = [];
      let published = 0;

      for (const extracted of result.candidates) {
        const firstLineId = extracted.candidate.evidence.lineIds[0];
        const page =
          (firstLineId ? pageByLineId.get(firstLineId) : undefined) ??
          parsedPages.find((item) => item.pageNumber === extracted.pageNumbers[0]);
        if (!page) continue;
        const lineById = new Map(page.lines.map((line) => [line.id, line]));
        const candidate = extracted.candidate;
        const grounded = groundCandidate(candidate, { text: page.text, lines: page.lines });
        if (grounded.status === "published") published += 1;

        rows.push({
          documentId,
          pageId: page.id,
          pageNumber: page.pageNumber,
          subject: candidate.subject,
          predicate: candidate.predicate,
          rawValue: candidate.rawValue,
          canonicalValue: grounded.canonicalValue,
          canonicalNumber: grounded.canonicalNumber,
          unit: grounded.unit,
          valueType: candidate.valueType,
          normalizationRule: grounded.normalizationRule,
          periodStart: grounded.period?.start,
          periodEnd: grounded.period?.end,
          periodPrecision: grounded.period?.precision,
          qualifiers: candidate.qualifiers,
          modality: candidate.modality,
          attributedTo: candidate.attributedTo,
          source: candidate.source,
          tableContext: candidate.tableContext,
          evidenceQuote: candidate.evidence.quote,
          evidenceLineIds: candidate.evidence.lineIds,
          evidenceBbox: unionBbox(
            candidate.evidence.lineIds.flatMap((id) => {
              const line = lineById.get(id);
              return line ? [line.bbox] : [];
            }),
          ),
          verified: grounded.verified,
          contextComplete: grounded.contextComplete,
          status: grounded.status,
          rejectionReason: grounded.rejectionReason,
          rejectionDetail: grounded.rejectionDetail,
          confidence: candidate.confidence,
          salience: extracted.salience,
          pipelineVersion,
        });
      }

      for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK) {
        await db.insert(assertions).values(rows.slice(offset, offset + INSERT_CHUNK));
      }

      const log = useLogger();
      log.set({
        job: { id: jobId, documentId, pipelineVersion, stages: ["extract"] },
        extract: {
          pages: parsedPages.length,
          candidates: result.candidates.length,
          stored: rows.length,
          published,
          rejected: rows.length - published,
        },
        timing: { stage: "extract", durationMs: Date.now() - startedAt, attempt: attempt + 1 },
      });
      log.info(`extracted ${parsedPages.length} page(s): ${pageNumbers.join(", ")}`);

      return {
        pages: parsedPages.length,
        candidates: result.candidates.length,
        stored: rows.length,
        published,
        rejected: rows.length - published,
      };
    });
  },
);

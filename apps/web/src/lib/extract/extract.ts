import { assertionCandidateSchema } from "@superfact/db/contracts";
import type { AssertionCandidate } from "@superfact/db/contracts";
import { z } from "zod";

import { mapWithConcurrency } from "@/lib/concurrency";

import { batchProseBySection } from "./batches";
import { EXTRACTION_SYSTEM_PROMPT, prosePrompt, tablePrompt } from "./prompts";
import { computeSalience } from "./salience";
import { batchTableInputs } from "./tables";
import type {
  ExtractedCandidate,
  ExtractionDiagnostic,
  ExtractionPage,
  ExtractionResult,
  RepetitionCorpusEntry,
  StructuredOutputModel,
  TableExtractionInput,
} from "./types";

/**
 * What the model is actually asked for.
 *
 * `source` and `tableContext` are omitted because code decides both — a prose batch is prose and a
 * table cell carries the context the parser resolved for it, and every path below overwrites
 * whatever the model said. Asking anyway cost tokens on a field that could only introduce error,
 * and `tableContext.footnotes` carries a Zod default, which strict structured output rejects
 * outright: every property of an object has to be required.
 *
 * `qualifiers` becomes a list of pairs for the same reason — an open-ended record has no strict
 * JSON schema — and is folded back into an object on the way out.
 */
const modelCandidateSchema = assertionCandidateSchema
  .omit({ qualifiers: true, source: true, tableContext: true })
  .extend({
    qualifiers: z
      .array(z.object({ key: z.string().min(1), value: z.string() }))
      .superRefine((qualifiers, context) => {
        const seen = new Set<string>();
        for (const qualifier of qualifiers) {
          if (seen.has(qualifier.key)) {
            context.addIssue({
              code: "custom",
              message: `duplicate qualifier key: ${qualifier.key}`,
            });
          }
          seen.add(qualifier.key);
        }
      }),
  });
const modelCandidateListSchema = z.array(modelCandidateSchema);

/**
 * Model calls in flight at once, per batch.
 *
 * Multiplied by the concurrency limit on `extract-page-batch`, this is what the model provider's
 * rate limit actually sees. Raising either raises that product.
 */
const MODEL_CONCURRENCY = 6;

type WorkItem = {
  id: string;
  documentId: string;
  pageNumbers: number[];
  prompt: string;
  allowedLineIds: Set<string>;
  name: "prose_assertions" | "table_assertions";
  tableCells: TableExtractionInput[] | null;
};

export type ExtractOptions = {
  maxProseBatchChars?: number;
  repetitionCorpus?: readonly RepetitionCorpusEntry[];
};

function diagnostic(id: string, reason: ExtractionDiagnostic["reason"], error: unknown) {
  return { inputId: id, reason, detail: error instanceof Error ? error.message : String(error) };
}

/**
 * A model call itself failed, so the batch has a hole in it and should be retried.
 *
 * Only `model_error` reaches here. A single malformed candidate — a table value that does not match
 * its cell, a cited line that does not exist — is dropped and counted instead, because failing the
 * batch would throw away every good fact on four pages to punish one bad row. Those drops are not
 * swallowed: they travel in `diagnostics` and land in the stage's wide event.
 */
export class ExtractionIncompleteError extends Error {
  constructor(public readonly result: ExtractionResult) {
    const failures = result.diagnostics.filter((item) => item.reason === "model_error");
    super(
      `extraction incomplete: ${failures.map((item) => `${item.inputId}: ${item.detail}`).join("; ")}`,
    );
    this.name = "ExtractionIncompleteError";
  }
}

/** Runs phase 4 only. Candidates remain ungrounded and unnormalized. */
export async function extractAssertionCandidates(
  pages: readonly ExtractionPage[],
  model: StructuredOutputModel,
  options: ExtractOptions = {},
): Promise<ExtractionResult> {
  const proseWork: WorkItem[] = batchProseBySection(pages, options.maxProseBatchChars).map(
    (batch) => ({
      id: batch.id,
      documentId: pages[0]?.documentId ?? "",
      pageNumbers: batch.pages.map((page) => page.pageNumber),
      prompt: prosePrompt(batch),
      allowedLineIds: new Set(batch.pages.flatMap((page) => page.lines.map((line) => line.id))),
      name: "prose_assertions",
      tableCells: null,
    }),
  );
  const tableWork: WorkItem[] = batchTableInputs(pages).map((input) => ({
    id: input.id,
    documentId: input.documentId,
    pageNumbers: [input.pageNumber],
    prompt: tablePrompt(input),
    allowedLineIds: new Set(input.cells.flatMap((cell) => cell.lineIds)),
    name: "table_assertions",
    tableCells: input.cells,
  }));

  const candidates: ExtractedCandidate[] = [];
  const diagnostics: ExtractionDiagnostic[] = [];
  const workItems = [...proseWork, ...tableWork];

  // The calls go out together; what comes back is still processed in order. A batch of a hundred
  // prose sections and table cells is a hundred round trips, and doing them one at a time was the
  // single biggest thing standing between a page being parsed and its facts being on screen.
  const responses = await mapWithConcurrency(workItems, MODEL_CONCURRENCY, async (item) => {
    const call = () =>
      model.generate({
        name: item.name,
        system: EXTRACTION_SYSTEM_PROMPT,
        prompt: item.prompt,
        schema: modelCandidateListSchema,
      });

    try {
      return { output: await call() };
    } catch {
      // One more sampling before the batch gives up. A response the provider could not shape into
      // the schema usually parses on a second attempt, and without this retry one flaky call out of
      // several hundred fails a hundred-page document that had already extracted five thousand
      // facts — which is what happened the first time this ran for real.
    }

    try {
      return { output: await call() };
    } catch (error) {
      return { error };
    }
  });

  for (const [index, work] of workItems.entries()) {
    const response = responses[index]!;
    if ("error" in response) {
      diagnostics.push(diagnostic(work.id, "model_error", response.error));
      continue;
    }

    const parsed = modelCandidateListSchema.safeParse(response.output);
    if (!parsed.success) {
      diagnostics.push(diagnostic(work.id, "invalid_output", z.prettifyError(parsed.error)));
      continue;
    }

    for (const modelCandidate of parsed.data) {
      const unknown = modelCandidate.evidence.lineIds.filter((id) => !work.allowedLineIds.has(id));
      if (unknown.length > 0) {
        // Kept as a candidate anyway. The verbatim gate is what decides publication, and it will
        // reject this for `line_not_found` with the invented id on the record — which is a more
        // useful artifact in the failures view than a diagnostic nobody reads.
        diagnostics.push(
          diagnostic(work.id, "unknown_line_id", `candidate cited ${unknown.join(", ")}`),
        );
      }

      let sourceAndContext: Pick<AssertionCandidate, "source" | "tableContext"> = {
        source: "prose",
        tableContext: null,
      };
      if (work.tableCells) {
        const cited = new Set(modelCandidate.evidence.lineIds);
        const matchingCells = work.tableCells.filter(
          (cell) =>
            cell.lineIds.some((lineId) => cited.has(lineId)) &&
            modelCandidate.evidence.lineIds.every((lineId) => cell.lineIds.includes(lineId)),
        );
        if (matchingCells.length !== 1) {
          diagnostics.push(
            diagnostic(
              work.id,
              "invalid_output",
              `table candidate maps to ${matchingCells.length} input cells`,
            ),
          );
          continue;
        }
        const cell = matchingCells[0]!;
        if (modelCandidate.rawValue !== cell.value) {
          diagnostics.push(
            diagnostic(
              work.id,
              "invalid_output",
              `table candidate rawValue does not equal ${cell.id}`,
            ),
          );
          continue;
        }
        sourceAndContext = { source: "table", tableContext: cell.context };
      }

      const converted = assertionCandidateSchema.safeParse({
        ...modelCandidate,
        ...sourceAndContext,
        qualifiers: Object.fromEntries(
          modelCandidate.qualifiers.map(({ key, value }) => [key, value]),
        ),
      });
      if (!converted.success) {
        diagnostics.push(diagnostic(work.id, "invalid_output", z.prettifyError(converted.error)));
        continue;
      }
      const candidate = converted.data;

      candidates.push({
        documentId: work.documentId,
        pageNumbers: work.pageNumbers,
        candidate,
        salience: computeSalience(candidate, work.documentId, options.repetitionCorpus),
      });
    }
  }

  const result = { candidates, diagnostics };
  if (diagnostics.some((item) => item.reason === "model_error")) {
    throw new ExtractionIncompleteError(result);
  }
  return result;
}

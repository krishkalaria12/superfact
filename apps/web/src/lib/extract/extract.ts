import { assertionCandidateSchema } from "@superfact/db/contracts";
import type { AssertionCandidate } from "@superfact/db/contracts";
import { z } from "zod";

import { mapWithConcurrency } from "../concurrency.ts";

import { batchProseBySection } from "./batches.ts";
import { EXTRACTION_SYSTEM_PROMPT, prosePrompt, tablePrompt } from "./prompts.ts";
import { computeSalience } from "./salience.ts";
import { batchTableInputs } from "./tables.ts";
import { PermanentModelFailure, StructuredOutputFailure } from "./types.ts";
import type {
  ExtractedCandidate,
  ExtractionDiagnostic,
  ExtractionPage,
  ExtractionResult,
  ProseBatch,
  RepetitionCorpusEntry,
  StructuredOutputModel,
  TableExtractionInput,
} from "./types.ts";

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
  proseBatch: ProseBatch | null;
};

export type ExtractOptions = {
  maxProseBatchChars?: number;
  repetitionCorpus?: readonly RepetitionCorpusEntry[];
};

/**
 * Names the parser already supplies, which the model must not re-supply as qualifiers.
 *
 * A table cell arrives with its title, headers, unit line, and footnotes attached by code, and the
 * model kept copying them back as qualifier keys — along with `cellId` and `tableId`, which are our
 * own identifiers. That is not context about the claim, and it is actively harmful downstream:
 * adjudication compares scope on the qualifier keys two assertions share, so a per-cell id can
 * never match and a repeated `title` matches for the wrong reason.
 *
 * A document that genuinely names a qualifier "title" loses nothing worth keeping; the parser's
 * title is already on the row.
 */
const SUPPLIED_CONTEXT_KEYS = new Set([
  "title",
  "columnheader",
  "column",
  "rowheader",
  "row",
  "unitline",
  "unit",
  "footnote",
  "footnotes",
  "cellid",
  "tableid",
  "pagenumber",
  "page",
  "lineid",
  "lineids",
]);

function toQualifiers(pairs: readonly { key: string; value: string }[]) {
  return Object.fromEntries(
    pairs
      .filter(({ key }) => !SUPPLIED_CONTEXT_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, "")))
      .map(({ key, value }) => [key, value]),
  );
}

function diagnostic(id: string, reason: ExtractionDiagnostic["reason"], error: unknown) {
  return {
    inputId: id,
    reason,
    detail: error instanceof Error ? error.message : String(error),
    ...(error instanceof PermanentModelFailure ? { permanent: true } : {}),
  };
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
  // Assigned rather than declared as a constructor parameter property: node's type stripping runs
  // the test suite over these modules directly, and it cannot rewrite that syntax.
  readonly result: ExtractionResult;
  readonly permanent: boolean;

  constructor(result: ExtractionResult) {
    const failures = result.diagnostics.filter((item) => item.reason === "model_error");
    super(
      `extraction incomplete: ${failures.map((item) => `${item.inputId}: ${item.detail}`).join("; ")}`,
    );
    this.name = "ExtractionIncompleteError";
    this.result = result;
    this.permanent = failures.some((failure) => failure.permanent);
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
      proseBatch: batch,
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
    proseBatch: null,
  }));

  function splitProseBatch(batch: ProseBatch): [ProseBatch, ProseBatch] | null {
    const lines = batch.pages.flatMap((page) =>
      page.lines.map((line) => ({ pageNumber: page.pageNumber, line })),
    );
    if (lines.length < 2) return null;

    const totalChars = lines.reduce((sum, item) => sum + item.line.text.length + 1, 0);
    let chars = 0;
    let splitAt = 1;
    for (let index = 0; index < lines.length - 1; index++) {
      chars += lines[index]!.line.text.length + 1;
      splitAt = index + 1;
      if (chars >= totalChars / 2) break;
    }

    const makeHalf = (items: typeof lines, suffix: string): ProseBatch => {
      const pages: ProseBatch["pages"] = [];
      for (const item of items) {
        const page = pages.at(-1);
        if (page?.pageNumber === item.pageNumber) page.lines.push(item.line);
        else pages.push({ pageNumber: item.pageNumber, lines: [item.line] });
      }
      return { id: `${batch.id}-${suffix}`, sectionTitle: batch.sectionTitle, pages };
    };

    return [makeHalf(lines.slice(0, splitAt), "a"), makeHalf(lines.slice(splitAt), "b")];
  }

  const candidates: ExtractedCandidate[] = [];
  const diagnostics: ExtractionDiagnostic[] = [];
  const workItems = [...proseWork, ...tableWork];

  // The calls go out together; what comes back is still processed in order. A batch of a hundred
  // prose sections and table cells is a hundred round trips, and doing them one at a time was the
  // single biggest thing standing between a page being parsed and its facts being on screen.
  const responses = await mapWithConcurrency(workItems, MODEL_CONCURRENCY, async (item) => {
    const call = (prompt = item.prompt) =>
      model.generate({
        name: item.name,
        system: EXTRACTION_SYSTEM_PROMPT,
        prompt,
        schema: modelCandidateListSchema,
      });

    const callTwice = async (prompt: string) => {
      try {
        return { output: await call(prompt) } as const;
      } catch (error) {
        if (error instanceof PermanentModelFailure) return { error } as const;
        // One more sampling before splitting or giving up. Structured output failures are often
        // transient, and this keeps the common recovery to one extra request.
      }

      try {
        return { output: await call(prompt) } as const;
      } catch (error) {
        return { error } as const;
      }
    };

    const response = await callTwice(item.prompt);
    if (
      !("error" in response) ||
      !(response.error instanceof StructuredOutputFailure) ||
      !item.proseBatch
    ) {
      return response;
    }

    const halves = splitProseBatch(item.proseBatch);
    if (!halves) return response;

    const outputs: unknown[] = [];
    for (const half of halves) {
      const halfResponse = await callTwice(prosePrompt(half));
      if ("error" in halfResponse) return halfResponse;
      if (!Array.isArray(halfResponse.output)) {
        return { error: new Error(`split ${half.id} returned a non-array output`) } as const;
      }
      outputs.push(...halfResponse.output);
    }
    return { output: outputs } as const;
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
        qualifiers: toQualifiers(modelCandidate.qualifiers),
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

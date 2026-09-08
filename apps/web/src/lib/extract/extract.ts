import { assertionCandidateSchema } from "@superfact/db/contracts";
import type { AssertionCandidate } from "@superfact/db/contracts";
import { z } from "zod";

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

const modelCandidateSchema = assertionCandidateSchema.omit({ qualifiers: true }).extend({
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

/** A model call failed or returned unusable structured output. The partial result aids diagnosis. */
export class ExtractionIncompleteError extends Error {
  constructor(public readonly result: ExtractionResult) {
    const failures = result.diagnostics.filter(
      (item) => item.reason === "model_error" || item.reason === "invalid_output",
    );
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

  for (const work of [...proseWork, ...tableWork]) {
    let output: unknown;
    try {
      output = await model.generate({
        name: work.name,
        system: EXTRACTION_SYSTEM_PROMPT,
        prompt: work.prompt,
        schema: modelCandidateListSchema,
      });
    } catch (error) {
      diagnostics.push(diagnostic(work.id, "model_error", error));
      continue;
    }

    const parsed = modelCandidateListSchema.safeParse(output);
    if (!parsed.success) {
      diagnostics.push(diagnostic(work.id, "invalid_output", z.prettifyError(parsed.error)));
      continue;
    }

    for (const modelCandidate of parsed.data) {
      const unknown = modelCandidate.evidence.lineIds.filter((id) => !work.allowedLineIds.has(id));
      if (unknown.length > 0) {
        diagnostics.push(
          diagnostic(work.id, "unknown_line_id", `candidate cited ${unknown.join(", ")}`),
        );
        const converted = assertionCandidateSchema.parse({
          ...modelCandidate,
          source: work.tableCells ? "table" : "prose",
          tableContext: null,
          qualifiers: Object.fromEntries(
            modelCandidate.qualifiers.map(({ key, value }) => [key, value]),
          ),
        });
        candidates.push({
          documentId: work.documentId,
          pageNumbers: work.pageNumbers,
          candidate: converted,
          salience: computeSalience(converted, work.documentId, options.repetitionCorpus),
        });
        continue;
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
  if (
    diagnostics.some((item) => item.reason === "model_error" || item.reason === "invalid_output")
  ) {
    throw new ExtractionIncompleteError(result);
  }
  return result;
}

import type { AssertionCandidate, ParsedLine, ReconstructedTable } from "@superfact/db/contracts";
import type { z } from "zod";

export type ExtractionPage = {
  documentId: string;
  pageNumber: number;
  lines: ParsedLine[];
  tables: ReconstructedTable[];
};

export type PageLineBlock = {
  pageNumber: number;
  lines: Pick<ParsedLine, "id" | "text">[];
};

export type ProseBatch = {
  id: string;
  sectionTitle: string | null;
  pages: PageLineBlock[];
};

export type TableExtractionInput = {
  id: string;
  documentId: string;
  pageNumber: number;
  tableId: string;
  value: string;
  lineIds: string[];
  context: {
    title: string | null;
    rowHeader: string | null;
    columnHeader: string | null;
    unitLine: string | null;
    footnotes: string[];
  };
};

export type TableExtractionBatch = {
  id: string;
  documentId: string;
  pageNumber: number;
  tableId: string;
  cells: TableExtractionInput[];
};

export type StructuredOutputRequest<T> = {
  name: "prose_assertions" | "table_assertions";
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
};

export interface StructuredOutputModel {
  generate<T>(request: StructuredOutputRequest<T>): Promise<unknown>;
}

export type ExtractionDiagnostic = {
  inputId: string;
  reason: "invalid_output" | "unknown_line_id" | "model_error";
  detail: string;
};

export type ExtractedCandidate = {
  documentId: string;
  pageNumbers: number[];
  candidate: AssertionCandidate;
  salience: number;
};

export type ExtractionResult = {
  candidates: ExtractedCandidate[];
  diagnostics: ExtractionDiagnostic[];
};

export type RepetitionCorpusEntry = Pick<
  AssertionCandidate,
  "subject" | "predicate" | "rawValue" | "unit"
> & { documentId: string };

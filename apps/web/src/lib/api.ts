import type {
  ClaimEdge,
  Failures,
  ParsedLine,
  PublishedAssertion,
  ReconstructedTable,
  RejectedAssertion,
} from "@superfact/db/contracts";
import type { DocumentFailureReason, DocumentStatus, EdgeVerdict, JobStage } from "@superfact/db";

/**
 * What the workspace reads. The API routes are the contract; this file only names their shapes so
 * a component cannot quietly disagree with the endpoint it calls.
 */

export type DocumentRow = {
  id: string;
  filename: string;
  contentHash: string;
  byteSize: number;
  pageCount: number | null;
  status: DocumentStatus;
  failureReason: DocumentFailureReason | null;
  failureDetail: string | null;
  pipelineVersion: string | null;
  createdAt: string;
  facts: { published: number; rejected: number };
  job: { id: string; stage: JobStage; status: string } | null;
};

export type DocumentDetailsResponse = {
  document: Omit<DocumentRow, "facts" | "job">;
  coverage: Omit<Progress, "job">;
  failedPages: {
    page: number;
    reason: string | null;
    detail: string | null;
  }[];
};

export type Progress = {
  pageCount: number | null;
  pagesParsed: number;
  pagesFailed: number;
  job: { id: string; stage: JobStage; status: string } | null;
};

export type FactsResponse = {
  document: {
    id: string;
    filename: string;
    status: DocumentStatus;
    pipelineVersion: string | null;
  };
  progress: Progress;
  total: number;
  offset: number;
  facts: (PublishedAssertion | RejectedAssertion)[];
};

export type EdgeWithSides = ClaimEdge & {
  source: PublishedAssertion | null;
  target: PublishedAssertion | null;
};

export type EdgesResponse = {
  document: { id: string; filename: string };
  counts: Record<EdgeVerdict, number>;
  total: number;
  edges: EdgeWithSides[];
};

export type PageResponse = {
  page: {
    documentId: string;
    pageNumber: number;
    width: number | null;
    height: number | null;
    rasterUrl: string | null;
    rasterScale: number | null;
    status: string;
    failureReason: string | null;
    failureDetail: string | null;
  };
  lines: ParsedLine[];
  tables: ReconstructedTable[];
};

export type ExportResponse = {
  pipelineVersion: string;
  exportedAt: string;
  failures: Failures;
};

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `${response.status} from ${url}`);
  }
  return (await response.json()) as T;
}

/**
 * One version string, stamped on every job and every assertion it publishes. Bump it when a
 * change to parsing, extraction, or adjudication makes earlier output non-comparable — that is
 * what invalidates reuse of a previous run over the same content hash.
 */
export const PIPELINE_VERSION = "0.2.0";

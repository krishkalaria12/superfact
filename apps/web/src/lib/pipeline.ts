import { env } from "@superfact/env/server";

import { pipelineVersionFor } from "@/lib/ai-provider-config";

/**
 * One version string, stamped on every job and every assertion it publishes. Bump it when a
 * change to parsing, extraction, or adjudication makes earlier output non-comparable — that is
 * what invalidates reuse of a previous run over the same content hash.
 */
export const PIPELINE_VERSION = pipelineVersionFor("0.7.0", env.AI_PROVIDER);

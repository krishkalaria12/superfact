import assert from "node:assert/strict";
import test from "node:test";

import { modelConfigFor, pipelineVersionFor } from "./ai-provider-config.ts";

test("OpenAI remains the default model family", () => {
  assert.deepEqual(modelConfigFor("openai"), {
    extraction: "gpt-5.6-luna",
    adjudication: "gpt-5.6-terra",
    embedding: "text-embedding-3-small",
  });
});

test("Gemini uses the current Flash and 1536-compatible embedding models", () => {
  assert.deepEqual(modelConfigFor("gemini"), {
    extraction: "gemini-3.8-flash",
    adjudication: "gemini-3.8-flash",
    embedding: "gemini-embedding-2",
  });
});

test("provider changes invalidate prior pipeline output", () => {
  assert.equal(pipelineVersionFor("0.7.0", "openai"), "0.7.0-openai");
  assert.equal(pipelineVersionFor("0.7.0", "gemini"), "0.7.0-gemini");
});

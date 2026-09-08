import assert from "node:assert/strict";
import test from "node:test";

import { retryStorageRequest } from "./storage-retry.ts";

test("retries a transient storage lookup", async () => {
  let calls = 0;
  const result = await retryStorageRequest(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error("transport unavailable");
      return "stored-object";
    },
    4,
    async () => {},
  );

  assert.equal(result, "stored-object");
  assert.equal(calls, 2);
});

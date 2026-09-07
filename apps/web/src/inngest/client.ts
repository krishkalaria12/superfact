import { env } from "@superfact/env/server";
import { eventType, Inngest } from "inngest";
import { z } from "zod";

/** Emitted once a job row is committed. Carries the job ID and nothing derived from it. */
export const jobRunRequested = eventType("job/run.requested", {
  schema: z.object({ jobId: z.uuid() }),
});

export const inngest = new Inngest({
  id: "superfact",
  // The local Inngest dev server needs no keys; cloud mode requires a signing key.
  isDev: env.NODE_ENV !== "production",
});

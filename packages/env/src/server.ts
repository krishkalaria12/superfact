import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * Server-side environment contract.
 *
 * A variable is required only from the phase that first reads it, so a fresh clone can run
 * phase 00 with nothing but a Neon connection string. The comment on each optional variable
 * names the phase that makes it mandatory.
 */
export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

    // Neon Postgres. The single canonical database.
    DATABASE_URL: z.string().min(1),

    // Model provider for extraction and adjudication. Required from phase 04.
    OPENAI_API_KEY: z.string().min(1).optional(),

    // UploadThing, for original PDF bytes and rendered page rasters. Required from phase 02:
    // uploads are the only way a document enters the system, so the app is inert without it.
    UPLOADTHING_TOKEN: z.string().min(1),

    // Inngest. The local dev server needs neither key; both are required once deployed
    // (phase 10). INNGEST_DEV points the SDK at a dev server on a non-default host.
    INNGEST_EVENT_KEY: z.string().min(1).optional(),
    INNGEST_SIGNING_KEY: z.string().min(1).optional(),
    INNGEST_DEV: z.string().min(1).optional(),
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});

import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

/**
 * Creates the Postgres extensions the schema needs before drizzle-kit touches it.
 *
 * `assertions.embedding` is `vector(1536)`, and a push against a database without pgvector fails
 * on an unknown type rather than on anything that explains itself. drizzle-kit does not manage
 * extensions, so `db:push` runs this first.
 *
 * The env file is read the same way `drizzle.config.ts` reads it: this runs as a script from the
 * package root, not inside the app, so there is no ambient `.env` to inherit.
 */
dotenv.config({ path: "../../apps/web/.env" });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set; copy apps/web/.env.example to apps/web/.env");
}

await neon(url)`CREATE EXTENSION IF NOT EXISTS vector`;
console.info("extensions ready: vector");

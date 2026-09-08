import { neon } from "@neondatabase/serverless";
import { env } from "@superfact/env/server";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema/index.ts";

export * from "./schema/index.ts";

export function createDb() {
  const sql = neon(env.DATABASE_URL);
  return drizzle(sql, { schema });
}

export const db = createDb();

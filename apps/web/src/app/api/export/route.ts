import { runExportSchema } from "@superfact/db/contracts";

import { createError, useLogger, withEvlog } from "@/lib/evlog";
import { buildExport } from "@/lib/export";

/**
 * The JSON export, for the whole corpus or one document with `?documentId=`.
 *
 * It is parsed against `runExportSchema` before it is served. That costs a few milliseconds and
 * buys the guarantee the export is for: a reviewer downloading this gets a file that matches the
 * published contract, or an error saying which field did not — never a plausible-looking file with
 * a field quietly missing.
 */
export const GET = withEvlog(async (request: Request) => {
  const documentId = new URL(request.url).searchParams.get("documentId") ?? undefined;

  const parsed = runExportSchema.safeParse(await buildExport(documentId));
  if (!parsed.success) {
    throw createError({
      status: 500,
      message: "The export does not match its own contract",
      why: parsed.error.issues.map((issue) => issue.path.join(".")).join(", "),
      fix: "Check @superfact/db/projection against the schema; a column is being lost",
    });
  }

  const log = useLogger();
  log.set({
    check: {
      name: "export",
      ok: true,
      differences: [],
    },
  });
  log.info(`exported ${parsed.data.facts.length} fact(s) and ${parsed.data.edges.length} edge(s)`);

  return new Response(JSON.stringify(parsed.data, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="superfact-${documentId ?? "corpus"}.json"`,
    },
  });
});

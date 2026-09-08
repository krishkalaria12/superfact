import { withEvlog } from "@/lib/evlog";
import { buildDemoCases } from "@/lib/cases";

/** Read-only: the four cases, selected from system output rather than written down. */
export const GET = withEvlog(async () => Response.json({ cases: await buildDemoCases() }));

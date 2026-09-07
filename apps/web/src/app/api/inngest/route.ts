import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";
import { withEvlog } from "@/lib/evlog";

const handler = serve({ client: inngest, functions });

// Inngest calls this route once per step, so wrapping it gives each step its own wide event and
// lets `useLogger()` resolve inside the pipeline function.
export const GET = withEvlog(handler.GET);
export const POST = withEvlog(handler.POST);
export const PUT = withEvlog(handler.PUT);

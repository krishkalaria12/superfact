import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";
import { withEvlog } from "@/lib/evlog";

const handler = serve({ client: inngest, functions });

// Each Inngest function here runs its work in one request rather than several steps, so this cap is
// what bounds a parse or extract batch. 300 seconds is both Inngest's recommended ceiling and the
// most a Vercel function gets outside Pro; a 25-page parse batch needs roughly 20 of them.
export const maxDuration = 300;

// Inngest calls this route once per step, so wrapping it gives each step its own wide event and
// lets `useLogger()` resolve inside the pipeline function.
export const GET = withEvlog(handler.GET);
export const POST = withEvlog(handler.POST);
export const PUT = withEvlog(handler.PUT);

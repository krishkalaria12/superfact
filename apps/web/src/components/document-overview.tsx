"use client";

import type { AssertionRejectionReason, EdgeVerdict } from "@superfact/db";
import { cn } from "@superfact/ui/lib/utils";

import { Readout, refusalGloss, verdictGloss } from "@/components/vocabulary";
import type { EdgesResponse, FactsResponse } from "@/lib/api";

/**
 * What this document produced, shown where the evidence goes before anything is selected.
 *
 * The pane to the right of the list is the largest area on the screen, and leaving it as a prompt
 * to click something wastes it. While a run is going this is where the numbers move; once it
 * finishes it is the shape of the result — how much was published, how much was refused and for
 * what reasons, and how the relationships came out.
 *
 * The refusal breakdown is deliberately as prominent as the fact count. A system whose argument is
 * that it declines to publish what it cannot ground should show the declining.
 */
export function DocumentOverview({
  facts,
  refused,
  links,
  onPickVerdict,
}: {
  facts: FactsResponse;
  refused: FactsResponse | null;
  links: EdgesResponse | null;
  onPickVerdict: (verdict: EdgeVerdict) => void;
}) {
  const running = facts.progress.job !== null;
  const total = facts.total + (refused?.total ?? 0);
  const share = total > 0 ? Math.round((facts.total / total) * 100) : 0;

  const reasons = tally(
    (refused?.facts ?? []).flatMap((fact) =>
      fact.status === "rejected" ? [fact.rejectionReason] : [],
    ),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <section className="space-y-4">
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          <Readout
            hint="Claims whose quote was found on the page and whose required context was present"
            label="published"
            value={facts.total}
          />
          <Readout
            hint="Claims the grounding gate would not stand behind"
            label="refused"
            tone="text-muted-foreground"
            value={refused?.total ?? 0}
          />
          <Readout
            hint="Judged pairs between this document and everything else stored"
            label="relationships"
            value={links?.total ?? 0}
          />
          <Readout
            label="pages read"
            value={`${facts.progress.pagesParsed}${facts.progress.pageCount ? ` / ${facts.progress.pageCount}` : ""}`}
          />
        </div>

        {total > 0 && (
          <div>
            <div className="flex h-1.5 w-full overflow-hidden bg-border">
              <div
                className="bg-foreground transition-[width] duration-700"
                style={{ width: `${share}%` }}
              />
            </div>
            <p className="mt-2 text-muted-foreground text-sm">
              {share}% of what the extractor proposed survived the gates.{" "}
              {running
                ? "Still reading, so this will move."
                : "The rest is below under Refused, each with the reason it was stopped."}
            </p>
          </div>
        )}
      </section>

      {reasons.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-medium">Why claims were refused</h3>
          <ul className="border border-border">
            {reasons.map(([reason, count]) => (
              <li
                className="flex items-baseline justify-between gap-4 border-border border-b px-3 py-2 last:border-b-0"
                key={reason}
              >
                <span className="min-w-0">
                  <span className="block font-mono text-sm">{reason.replaceAll("_", " ")}</span>
                  <span className="block text-muted-foreground text-xs">
                    {refusalGloss(reason)}
                  </span>
                </span>
                <span className="font-mono text-sm">{count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {links && links.total > 0 && (
        <section className="space-y-2">
          <h3 className="font-medium">How this document relates to the others</h3>
          <div className="grid gap-px border border-border bg-border sm:grid-cols-2">
            {(Object.keys(links.counts) as EdgeVerdict[])
              .filter((verdict) => links.counts[verdict] > 0)
              .map((verdict) => (
                <button
                  className="bg-background px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
                  key={verdict}
                  onClick={() => onPickVerdict(verdict)}
                  type="button"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className={cn("text-sm", TONE[verdict])}>{verdict}</span>
                    <span className="font-mono text-sm">{links.counts[verdict]}</span>
                  </span>
                  <span className="mt-0.5 block text-muted-foreground text-xs">
                    {verdictGloss(verdict)}
                  </span>
                </button>
              ))}
          </div>
        </section>
      )}

      <p className="text-muted-foreground text-sm">
        Pick anything on the left to see the region of the page it rests on. Arrow keys move through
        the list.
      </p>
    </div>
  );
}

const TONE: Record<EdgeVerdict, string> = {
  contradicts: "text-verdict-conflict",
  reconciles: "text-verdict-reconciled",
  corroborates: "text-verdict-agree",
  insufficient: "text-verdict-none",
};

function tally(reasons: readonly AssertionRejectionReason[]) {
  const counts = new Map<AssertionRejectionReason, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

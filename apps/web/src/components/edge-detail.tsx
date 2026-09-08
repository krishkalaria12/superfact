"use client";

import type { ComparisonField, PublishedAssertion } from "@superfact/db/contracts";
import { cn } from "@superfact/ui/lib/utils";

import { EvidenceViewer } from "@/components/evidence-viewer";
import { Cite, VerdictBadge, verdictGloss } from "@/components/vocabulary";
import type { EdgeWithSides } from "@/lib/api";

/**
 * One relationship, with both sides visible at once.
 *
 * The comparison strip between the two claims is the argument. A contradiction is not interesting
 * because two numbers differ — it is interesting because everything else about the two claims was
 * shown to be the same first, and this is where a reader checks that for themselves.
 */

const FIELD_GLOSS: Record<ComparisonField, string> = {
  subject: "what is being measured",
  predicate: "what is being said about it",
  time: "the period each covers",
  scope: "the segment or geography",
  unit: "the unit each is stated in",
  value: "the figure itself",
  modality: "observed against projected",
  attribution: "who is making the claim",
};

export function EdgeDetail({ edge }: { edge: EdgeWithSides }) {
  return (
    <article className="space-y-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <VerdictBadge verdict={edge.verdict} />
          <span className="text-muted-foreground text-sm">
            {edge.reasonCode.replaceAll("_", " ")}
          </span>
          {edge.confidence !== null && <Cite>confidence {edge.confidence.toFixed(2)}</Cite>}
        </div>
        <p className="max-w-prose text-pretty leading-relaxed">{edge.explanation}</p>
        <p className="text-muted-foreground text-sm">{verdictGloss(edge.verdict)}.</p>
      </header>

      {edge.priorPass && (
        <div className="border border-verdict-reconciled/40 bg-verdict-reconciled/8 p-3">
          <p className="font-medium text-sm">
            A first pass called this a contradiction. Asked to argue the opposite, a second pass
            found the qualifier that lets both stand.
          </p>
          <p className="mt-1.5 text-muted-foreground text-sm">{edge.priorPass.explanation}</p>
        </div>
      )}

      <ComparisonStrip edge={edge} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Side assertion={edge.source} label="One document says" />
        <Side assertion={edge.target} label="The other says" />
      </div>
    </article>
  );
}

/** Every dimension the two claims were compared on, and how each came out. */
function ComparisonStrip({ edge }: { edge: EdgeWithSides }) {
  const matched = new Set(edge.matchedFields);
  const mismatched = new Set(edge.mismatchedFields);
  const fields = Object.keys(FIELD_GLOSS) as ComparisonField[];

  return (
    <div className="border border-border">
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
        {fields.map((field) => {
          const state = matched.has(field) ? "same" : mismatched.has(field) ? "differs" : "unknown";
          return (
            <div className="bg-background px-3 py-2" key={field} title={FIELD_GLOSS[field]}>
              <div className="text-sm">{field}</div>
              <div
                className={cn(
                  "font-mono text-xs",
                  state === "same" && "text-verdict-agree",
                  state === "differs" && "text-verdict-conflict",
                  state === "unknown" && "text-muted-foreground",
                )}
              >
                {state === "unknown" ? "not comparable" : state}
              </div>
            </div>
          );
        })}
      </div>
      <p className="border-border border-t px-3 py-2 text-muted-foreground text-xs">
        A contradiction is only allowed to stand when time, scope, unit, modality, and attribution
        all read <span className="text-verdict-agree">same</span>.
      </p>
    </div>
  );
}

function Side({ assertion, label }: { assertion: PublishedAssertion | null; label: string }) {
  if (!assertion) {
    return (
      <p className="text-muted-foreground text-sm">
        {label}: this assertion is no longer published, so its evidence cannot be shown.
      </p>
    );
  }

  return (
    <section className="space-y-2">
      <h3 className="text-muted-foreground text-sm">{label}</h3>
      <p className="font-medium leading-snug">{assertion.subject}</p>
      <p className="text-muted-foreground text-sm">{assertion.predicate}</p>
      <p className="font-mono">
        {assertion.rawValue}
        {assertion.canonicalValue && assertion.canonicalValue !== assertion.rawValue && (
          <span className="text-muted-foreground"> = {assertion.canonicalValue}</span>
        )}
      </p>
      <Cite>
        {assertion.period
          ? `${assertion.period.start} to ${assertion.period.end}`
          : "no period stated"}
        {assertion.modality === "projected" ? "  projected" : ""}
        {assertion.attributedTo ? `  per ${assertion.attributedTo}` : ""}
      </Cite>
      <blockquote className="border-evidence border-l-2 bg-evidence-wash/40 py-1.5 pl-3 text-sm">
        {assertion.evidence.quote}
      </blockquote>
      <EvidenceViewer
        bbox={assertion.evidence.bbox}
        documentId={assertion.documentId}
        lineIds={assertion.evidence.lineIds}
        pageNumber={assertion.page}
        tableContext={assertion.tableContext}
      />
    </section>
  );
}

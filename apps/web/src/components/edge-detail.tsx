"use client";

import type { PublishedAssertion } from "@superfact/db/contracts";
import type { EdgeVerdict } from "@superfact/db";

import { EvidenceViewer } from "@/components/evidence-viewer";
import type { EdgeWithSides } from "@/lib/api";

/**
 * One relationship, side by side.
 *
 * Both evidence spans are on screen at once because that is what a reviewer has to compare. The
 * matched and mismatched fields sit between them, since the interesting question about a
 * contradiction is not that two numbers differ but that everything else was shown to be the same.
 */
export function EdgeDetail({ edge }: { edge: EdgeWithSides }) {
  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <VerdictBadge verdict={edge.verdict} />
          <span className="text-muted-foreground text-sm">
            {edge.reasonCode.replaceAll("_", " ")}
          </span>
        </div>
        <p className="text-sm leading-relaxed">{edge.explanation}</p>
      </header>

      {edge.priorPass && (
        <div className="border border-chart-3/40 bg-chart-3/5 p-3 text-sm">
          <p className="font-medium">
            A first pass called this {edge.priorPass.verdict}. The reversed-burden review overturned
            it.
          </p>
          <p className="mt-1 text-muted-foreground">{edge.priorPass.explanation}</p>
        </div>
      )}

      <div className="space-y-2 border border-border p-3 text-sm">
        <FieldList fields={edge.matchedFields} label="Same on both sides" tone="text-foreground" />
        <FieldList fields={edge.mismatchedFields} label="Differs" tone="text-destructive" />
        {edge.confidence !== null && (
          <p className="text-muted-foreground text-xs">confidence {edge.confidence.toFixed(2)}</p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Side assertion={edge.source} label="Source" />
        <Side assertion={edge.target} label="Target" />
      </div>
    </div>
  );
}

function Side({ assertion, label }: { assertion: PublishedAssertion | null; label: string }) {
  if (!assertion) {
    return (
      <p className="text-muted-foreground text-sm">
        {label}: the assertion is no longer published, so its evidence cannot be shown.
      </p>
    );
  }

  return (
    <section className="space-y-2">
      <h4 className="text-muted-foreground text-xs uppercase tracking-wide">{label}</h4>
      <p className="font-medium text-sm leading-snug">{assertion.subject}</p>
      <p className="text-muted-foreground text-sm">{assertion.predicate}</p>
      <p className="font-mono text-sm">
        {assertion.rawValue}
        {assertion.canonicalValue && assertion.canonicalValue !== assertion.rawValue && (
          <span className="text-muted-foreground"> → {assertion.canonicalValue}</span>
        )}
      </p>
      <p className="text-muted-foreground text-xs">
        {assertion.period
          ? `${assertion.period.start} to ${assertion.period.end}`
          : "no period stated"}
        {" · "}
        {assertion.modality}
        {assertion.attributedTo ? ` · per ${assertion.attributedTo}` : ""}
      </p>
      <blockquote className="border-border border-l-2 pl-3 text-sm italic">
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

function FieldList({
  fields,
  label,
  tone,
}: {
  fields: readonly string[];
  label: string;
  tone: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="text-muted-foreground text-xs uppercase tracking-wide">{label}</span>
      {fields.length === 0 ? (
        <span className="text-muted-foreground text-xs">none</span>
      ) : (
        fields.map((field) => (
          <span className={`border border-border px-1.5 py-0.5 text-xs ${tone}`} key={field}>
            {field}
          </span>
        ))
      )}
    </div>
  );
}

const VERDICT_TONE: Record<EdgeVerdict, string> = {
  contradicts: "border-destructive/50 text-destructive",
  reconciles: "border-chart-3/50 text-chart-3",
  corroborates: "border-border text-foreground",
  insufficient: "border-border text-muted-foreground",
};

export function VerdictBadge({ verdict }: { verdict: EdgeVerdict }) {
  return (
    <span className={`border px-2 py-0.5 font-medium text-xs ${VERDICT_TONE[verdict]}`}>
      {verdict}
    </span>
  );
}

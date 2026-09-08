"use client";

import type { PublishedAssertion, RejectedAssertion } from "@superfact/db/contracts";

import { EvidenceViewer } from "@/components/evidence-viewer";
import { Cite, refusalGloss } from "@/components/vocabulary";

/**
 * One fact, opened.
 *
 * As printed and canonical sit side by side because a published figure has to stay auditable
 * against the page it came from. Showing only the converted number would hide the one step most
 * likely to be wrong, and showing only the printed one would make nothing comparable.
 */
export function FactDetail({ fact }: { fact: PublishedAssertion | RejectedAssertion }) {
  const canonical = fact.canonicalValue
    ? `${fact.canonicalValue}${fact.unit ? ` ${fact.unit}` : ""}`
    : null;

  return (
    <article className="space-y-5">
      <header className="space-y-1.5">
        <h2 className="text-balance font-medium text-xl leading-snug tracking-tight">
          {fact.subject}
        </h2>
        <p className="text-muted-foreground">{fact.predicate}</p>
      </header>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-border border-y py-3">
        <span className="font-mono text-lg">{fact.rawValue}</span>
        {canonical && canonical !== fact.rawValue && (
          <>
            <span className="text-muted-foreground text-sm">normalizes to</span>
            <span className="font-mono text-evidence text-lg">{canonical}</span>
          </>
        )}
        {fact.normalizationRule && <Cite>by {fact.normalizationRule}</Cite>}
      </div>

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
        <Field
          label="Period"
          value={fact.period ? `${fact.period.start} to ${fact.period.end}` : "none stated"}
          note={fact.period?.precision.replace("_", " ")}
        />
        <Field
          label="Stated as"
          value={fact.modality === "projected" ? "a projection" : "an observation"}
        />
        <Field
          label="Asserted by"
          value={fact.attributedTo ?? "the document itself"}
          note={fact.attributedTo ? "reported, not asserted" : undefined}
        />
      </dl>

      {Object.keys(fact.qualifiers).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(fact.qualifiers).map(([key, value]) => (
            <span className="border border-border px-2 py-0.5 text-xs" key={key}>
              <span className="text-muted-foreground">{key.replaceAll("_", " ")} </span>
              {value}
            </span>
          ))}
        </div>
      )}

      {fact.status === "rejected" && (
        <div className="border border-destructive/30 bg-destructive/5 p-3">
          <p className="font-medium text-destructive text-sm">
            Not published, because {refusalGloss(fact.rejectionReason)}.
          </p>
          {fact.rejectionDetail && (
            <p className="mt-1 text-muted-foreground text-sm">{fact.rejectionDetail}</p>
          )}
          <p className="mt-2 text-muted-foreground text-xs">
            Quote checked against the page: {fact.verified ? "passed" : "failed"}. Required context
            present: {fact.contextComplete ? "yes" : "no"}.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <blockquote className="border-evidence border-l-2 bg-evidence-wash/40 py-1.5 pl-3 text-sm">
          {fact.evidence.quote}
        </blockquote>
        <Cite>{fact.evidence.lineIds.join("  ")}</Cite>
      </div>

      <EvidenceViewer
        bbox={fact.evidence.bbox}
        documentId={fact.documentId}
        lineIds={fact.evidence.lineIds}
        pageNumber={fact.page}
        tableContext={fact.tableContext}
      />
    </article>
  );
}

function Field({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="break-words text-sm">{value}</dd>
      {note && <dd className="text-muted-foreground text-xs">{note}</dd>}
    </div>
  );
}

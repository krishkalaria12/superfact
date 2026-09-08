"use client";

import type { PublishedAssertion, RejectedAssertion } from "@superfact/db/contracts";

import { EvidenceViewer } from "@/components/evidence-viewer";

/**
 * One fact, opened.
 *
 * Raw value and canonical value sit next to each other on purpose: a published figure has to stay
 * auditable against the page it came from, and showing only the normalized number would hide the
 * one conversion most likely to be wrong.
 */
export function FactDetail({ fact }: { fact: PublishedAssertion | RejectedAssertion }) {
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h3 className="font-medium leading-snug">{fact.subject}</h3>
        <p className="text-muted-foreground text-sm">{fact.predicate}</p>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border border-border p-3 text-sm">
        <Field label="As printed" value={fact.rawValue} mono />
        <Field
          label="Canonical"
          mono
          value={
            fact.canonicalValue
              ? `${fact.canonicalValue}${fact.unit ? ` ${fact.unit}` : ""}`
              : "not normalized"
          }
        />
        <Field
          label="Period"
          value={
            fact.period
              ? `${fact.period.start} to ${fact.period.end} (${fact.period.precision.replace("_", " ")})`
              : "none stated"
          }
        />
        <Field label="Modality" value={fact.modality} />
        <Field label="Attributed to" value={fact.attributedTo ?? "the document itself"} />
        <Field label="Rule" value={fact.normalizationRule ?? "none"} mono />
      </dl>

      {Object.keys(fact.qualifiers).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(fact.qualifiers).map(([key, value]) => (
            <span
              className="border border-border px-2 py-0.5 text-xs"
              key={key}
              title={`${key}: ${value}`}
            >
              <span className="text-muted-foreground">{key.replaceAll("_", " ")}</span> {value}
            </span>
          ))}
        </div>
      )}

      {fact.status === "rejected" && (
        <div className="border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">
            Refused: {fact.rejectionReason.replaceAll("_", " ")}
          </p>
          {fact.rejectionDetail && (
            <p className="mt-1 text-muted-foreground">{fact.rejectionDetail}</p>
          )}
          <p className="mt-2 text-muted-foreground text-xs">
            verified {String(fact.verified)} · context complete {String(fact.contextComplete)}
          </p>
        </div>
      )}

      <figure className="space-y-2">
        <blockquote className="border-border border-l-2 pl-3 text-sm italic">
          {fact.evidence.quote}
        </blockquote>
        <figcaption className="font-mono text-muted-foreground text-xs">
          {fact.evidence.lineIds.join(" · ")}
        </figcaption>
      </figure>

      <EvidenceViewer
        bbox={fact.evidence.bbox}
        documentId={fact.documentId}
        lineIds={fact.evidence.lineIds}
        pageNumber={fact.page}
        tableContext={fact.tableContext}
      />
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs uppercase tracking-wide">{label}</dt>
      <dd className={`break-words ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}

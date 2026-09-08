import type { AssertionRejectionReason, EdgeVerdict } from "@superfact/db";
import { cn } from "@superfact/ui/lib/utils";

/**
 * The controlled vocabulary, drawn once.
 *
 * Four verdicts and a handful of refusal codes appear on nearly every screen, so they get one
 * appearance each and keep it. Colour carries meaning here rather than decoration: conflict is the
 * only red, an explained difference is the only ochre, and abstention is deliberately the quietest
 * thing on the page — a system that declined to answer should not look like one that answered.
 */

const VERDICT: Record<EdgeVerdict, { tone: string; gloss: string }> = {
  contradicts: {
    tone: "border-verdict-conflict/40 text-verdict-conflict bg-verdict-conflict/8",
    gloss: "These cannot both be true, and everything else about them lines up",
  },
  reconciles: {
    tone: "border-verdict-reconciled/50 text-verdict-reconciled bg-verdict-reconciled/10",
    gloss: "They look opposed until you compare the context that explains both",
  },
  corroborates: {
    tone: "border-verdict-agree/40 text-verdict-agree bg-verdict-agree/8",
    gloss: "Both documents say the same thing",
  },
  insufficient: {
    tone: "border-border text-verdict-none",
    gloss: "The context needed to compare them is missing from one side",
  },
};

export function VerdictBadge({ verdict, className }: { verdict: EdgeVerdict; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center border px-1.5 font-medium text-xs",
        VERDICT[verdict].tone,
        className,
      )}
      title={VERDICT[verdict].gloss}
    >
      {verdict}
    </span>
  );
}

export function verdictGloss(verdict: EdgeVerdict) {
  return VERDICT[verdict].gloss;
}

/** Why the grounding gate refused, in words a reader can act on. */
const REFUSAL: Record<AssertionRejectionReason, string> = {
  quote_not_found: "the quoted words are not on the page",
  line_not_found: "the cited lines do not exist",
  missing_context: "the claim needs a period, geography, or segment it never states",
  value_not_in_source: "the value does not appear in the span it cites",
  normalization_failed: "the value could not be converted to a comparable form",
};

export function refusalGloss(reason: AssertionRejectionReason) {
  return REFUSAL[reason];
}

export function RefusalBadge({ reason }: { reason: AssertionRejectionReason }) {
  return (
    <span
      className="inline-flex h-5 shrink-0 items-center border border-destructive/30 bg-destructive/5 px-1.5 font-mono text-destructive text-xs"
      title={REFUSAL[reason]}
    >
      {reason.replaceAll("_", " ")}
    </span>
  );
}

/** A number and what it counts, sized so the number is what you read first. */
export function Readout({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number | string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0" title={hint}>
      <div className={cn("font-mono font-medium text-lg leading-none", tone)}>{value}</div>
      <div className="mt-1 truncate text-muted-foreground text-xs">{label}</div>
    </div>
  );
}

/** A citation: a page reference, a line ID, a hash. Never a sentence. */
export function Cite({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("font-mono text-muted-foreground text-xs", className)}>{children}</span>
  );
}

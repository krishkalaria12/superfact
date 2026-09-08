"use client";

import { EdgeDetail } from "@/components/edge-detail";
import { FactDetail } from "@/components/fact-detail";
import type { DemoCase } from "@/lib/cases";

/** One demo case, with whatever the system found for it, or a plain statement that it found none. */
export function CaseView({ case: item }: { case: DemoCase }) {
  const empty = !item.edge && !item.fact;

  return (
    <section className="space-y-3 border-border border-t pt-6">
      <header className="space-y-1">
        <h2 className="font-medium text-lg tracking-tight">{item.title}</h2>
        <p className="max-w-prose text-muted-foreground text-sm">{item.looksFor}</p>
      </header>

      {item.note && <p className="text-muted-foreground text-sm">{item.note}</p>}

      {empty ? (
        <p className="border border-border border-dashed p-4 text-muted-foreground text-sm">
          Nothing in the current corpus fits this case. Upload two documents that discuss the same
          figures and it will fill in.
        </p>
      ) : item.edge ? (
        <EdgeDetail edge={item.edge} />
      ) : item.fact ? (
        <FactDetail fact={item.fact} />
      ) : null}
    </section>
  );
}

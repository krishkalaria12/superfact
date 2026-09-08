"use client";

import { EdgeDetail } from "@/components/edge-detail";
import { FactDetail } from "@/components/fact-detail";
import type { DemoCase } from "@/lib/cases";

/** One case, with whatever the system found for it, or a plain statement that it found none. */
export function CaseView({ case: item, index }: { case: DemoCase; index: number }) {
  const empty = !item.edge && !item.fact;

  return (
    <li className="grid gap-6 border-border border-t pt-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <div className="space-y-2 lg:sticky lg:top-6 lg:self-start">
        <div className="font-mono text-muted-foreground text-sm">Case {index}</div>
        <h2 className="text-balance font-medium text-lg leading-snug tracking-tight">
          {item.title}
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed">{item.looksFor}</p>
      </div>

      <div className="min-w-0 space-y-4">
        {item.note && <p className="text-muted-foreground text-sm">{item.note}</p>}

        {empty && !item.note ? (
          <p className="border border-border border-dashed p-6 text-muted-foreground text-sm">
            Nothing in the current corpus fits this case. Two documents that discuss the same
            figures over the same period would fill it.
          </p>
        ) : empty ? null : item.edge ? (
          <EdgeDetail edge={item.edge} />
        ) : item.fact ? (
          <FactDetail fact={item.fact} />
        ) : null}
      </div>
    </li>
  );
}

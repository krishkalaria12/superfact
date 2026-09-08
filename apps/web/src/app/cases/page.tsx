import Link from "next/link";

import { CaseView } from "@/components/case-view";
import { buildDemoCases } from "@/lib/cases";

export const dynamic = "force-dynamic";

/**
 * The four cases the assignment asks to see.
 *
 * Every example on this page came out of a query against whatever the system produced. Nothing is
 * written down: no filename, no predicate, no value. Point it at PDFs nobody has seen and it either
 * fills the four in or says plainly that it found none.
 */
export default async function CasesPage() {
  const cases = await buildDemoCases();

  return (
    <main className="container mx-auto max-w-5xl space-y-8 px-4 py-10">
      <header className="space-y-2">
        <Link className="text-muted-foreground text-xs hover:text-foreground" href="/">
          ← All documents
        </Link>
        <h1 className="font-semibold text-2xl tracking-tight">Four cases</h1>
        <p className="max-w-prose text-muted-foreground text-sm">
          Each of these is a query over system output, not a fixture. An empty case is the honest
          answer that this corpus has not produced one yet.
        </p>
      </header>

      {cases.map((item) => (
        <CaseView case={item} key={item.key} />
      ))}
    </main>
  );
}

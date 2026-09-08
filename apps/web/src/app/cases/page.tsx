import { CaseView } from "@/components/case-view";
import { buildDemoCases } from "@/lib/cases";

export const dynamic = "force-dynamic";

/**
 * The four cases the assignment asks to see.
 *
 * Every example here came out of a query against whatever the system produced. Nothing is written
 * down: no filename, no predicate, no value. Point it at PDFs nobody has seen and it either fills
 * the four in or says plainly that it found none.
 *
 * Numbered, because this genuinely is an enumerated list someone is checking off — not because
 * numbering makes a page look organised.
 */
export default async function CasesPage() {
  const cases = await buildDemoCases();

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <header className="max-w-prose space-y-3">
        <h1 className="text-balance font-medium text-3xl leading-tight tracking-tight">
          Four cases, each picked by a query
        </h1>
        <p className="text-muted-foreground leading-relaxed">
          None of these examples is written into the code. Each is chosen by the shape of the
          result, so running the system over documents nobody has seen either fills a case in or
          reports that the corpus has not produced one. An empty case below is the honest answer.
        </p>
      </header>

      <ol className="mt-12 space-y-16">
        {cases.map((item, index) => (
          <CaseView case={item} index={index + 1} key={item.key} />
        ))}
      </ol>
    </main>
  );
}

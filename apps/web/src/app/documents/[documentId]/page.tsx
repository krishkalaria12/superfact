import { db, documents } from "@superfact/db";
import { eq } from "@superfact/db/orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Workspace } from "@/components/workspace";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  const [document] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!document) notFound();

  return (
    <main className="container mx-auto flex min-h-0 max-w-7xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <Link className="text-muted-foreground text-xs hover:text-foreground" href="/">
            ← All documents
          </Link>
          <h1 className="truncate font-semibold text-lg tracking-tight">{document.filename}</h1>
        </div>
        <a
          className="text-muted-foreground text-xs underline hover:text-foreground"
          href={`/api/export?documentId=${document.id}`}
        >
          Export this document as JSON
        </a>
      </header>

      {document.status === "failed" && document.failureReason && (
        <p className="border border-destructive/40 bg-destructive/5 p-3 text-destructive text-sm">
          Refused: {document.failureReason.replaceAll("_", " ")}
          {document.failureDetail ? ` — ${document.failureDetail}` : ""}
        </p>
      )}

      <Workspace documentId={document.id} />
    </main>
  );
}

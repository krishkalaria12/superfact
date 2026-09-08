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
    <main className="flex h-full min-h-0 flex-col">
      <div className="mx-auto flex w-full max-w-350 flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3">
        <div className="min-w-0">
          <Link
            className="text-muted-foreground text-xs transition-colors hover:text-foreground"
            href="/"
          >
            All documents
          </Link>
          <h1 className="truncate font-medium text-lg tracking-tight">{document.filename}</h1>
        </div>
        <a
          className="text-muted-foreground text-sm transition-colors hover:text-foreground"
          href={`/api/export?documentId=${document.id}`}
        >
          Download this document as JSON
        </a>
      </div>

      {document.status === "failed" && document.failureReason && (
        <div className="mx-auto w-full max-w-350 px-4 pb-3">
          <p className="border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm">
            This run stopped: {document.failureReason.replaceAll("_", " ")}.
            {document.failureDetail ? ` ${document.failureDetail}` : ""} Anything it published
            before stopping is below. Uploading the file again restarts it from the bytes already
            stored.
          </p>
        </div>
      )}

      <Workspace documentId={document.id} />
    </main>
  );
}

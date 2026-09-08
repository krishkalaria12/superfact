"use client";

import { useState } from "react";

import { DocumentList } from "@/components/document-list";
import { UploadArea } from "@/components/upload-area";

export default function Home() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <main className="container mx-auto max-w-3xl space-y-8 px-4 py-10">
      <header className="space-y-2">
        <h1 className="font-semibold text-2xl tracking-tight">Superfact</h1>
        <p className="max-w-prose text-muted-foreground text-sm">
          Every published fact carries the span it came from. Upload PDFs, then read what
          corroborates, what contradicts, and what only looked like a contradiction until a
          qualifier explained it.
        </p>
      </header>

      <UploadArea onUploaded={() => setRefreshKey((key) => key + 1)} />

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-medium text-sm">Documents</h2>
          <a
            className="text-muted-foreground text-xs underline hover:text-foreground"
            href="/api/export"
          >
            Export all as JSON
          </a>
        </div>
        <DocumentList refreshKey={refreshKey} />
      </section>
    </main>
  );
}

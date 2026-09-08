"use client";

import Link from "next/link";
import { useState } from "react";

import { DocumentList } from "@/components/document-list";
import { UploadArea } from "@/components/upload-area";

export default function Home() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <main className="mx-auto max-w-4xl space-y-10 px-4 py-12">
      <header className="max-w-prose space-y-3">
        <h1 className="text-balance font-medium text-3xl leading-tight tracking-tight">
          Every fact carries the region of the page that proves it.
        </h1>
        <p className="text-muted-foreground leading-relaxed">
          Superfact reads PDFs into individual claims, refuses any claim whose words it cannot find
          on the page, and then works out where two documents agree, where they conflict, and where
          they only look like they conflict until you compare when and what each one was measuring.
        </p>
      </header>

      <UploadArea onUploaded={() => setRefreshKey((key) => key + 1)} />

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-medium">Documents</h2>
          <Link
            className="text-muted-foreground text-sm transition-colors hover:text-foreground"
            href="/cases"
          >
            Four cases
          </Link>
        </div>
        <DocumentList refreshKey={refreshKey} />
      </section>
    </main>
  );
}

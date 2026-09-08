"use client";

import { Button } from "@superfact/ui/components/button";
import { useRef, useState } from "react";

type Outcome = {
  outcome: "accepted" | "reused" | "reprocessing" | "refused";
  jobId: string | null;
  document: {
    id: string;
    filename: string;
    failureReason: string | null;
    failureDetail: string | null;
  };
};

/**
 * The only way a document enters the system.
 *
 * All four outcomes are shown as outcomes, not three successes and an error. A refusal is the
 * system working — refusing a scan it cannot ground is the behaviour the plan asks for — so it
 * reads as an answer with a reason rather than as a failed upload.
 */
export function UploadArea({ onUploaded }: { onUploaded: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/documents", { method: "POST", body });
      const payload = (await response.json()) as Outcome & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? `upload failed (${response.status})`);
      setResult(payload);
      onUploaded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div
        className="flex items-center justify-between gap-4 border border-border border-dashed px-4 py-6"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file) void upload(file);
        }}
      >
        <div>
          <p className="font-medium text-sm">Drop a PDF, or choose one</p>
          <p className="text-muted-foreground text-xs">
            A file already processed at this pipeline version comes back immediately.
          </p>
        </div>
        <Button disabled={busy} onClick={() => input.current?.click()} variant="outline">
          {busy ? "Reading…" : "Choose file"}
        </Button>
        <input
          accept="application/pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = "";
          }}
          ref={input}
          type="file"
        />
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {result && (
        <p className="text-sm">
          <span className="font-medium">{result.outcome}</span>
          <span className="text-muted-foreground"> · {result.document.filename}</span>
          {result.document.failureReason && (
            <span className="text-destructive">
              {" "}
              · {result.document.failureReason.replaceAll("_", " ")}
              {result.document.failureDetail ? `: ${result.document.failureDetail}` : ""}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

"use client";

import { Button } from "@superfact/ui/components/button";
import { cn } from "@superfact/ui/lib/utils";
import { useRef, useState } from "react";
import { toast } from "sonner";

type Outcome = {
  outcome: "accepted" | "reused" | "reprocessing" | "refused";
  jobId: string | null;
  document: {
    id: string;
    filename: string;
    pageCount: number | null;
    failureReason: string | null;
    failureDetail: string | null;
  };
};

/**
 * The only way a document enters the system.
 *
 * All four outcomes are outcomes, not three successes and an error. Refusing a scan the system
 * cannot ground is the behaviour the design asks for, so a refusal reads as an answer with a
 * reason rather than as a failed upload.
 */
export function UploadArea({ onUploaded }: { onUploaded: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    const reading = toast.loading(`Hashing and checking ${file.name}`);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/documents", { method: "POST", body });
      const payload = (await response.json()) as Outcome & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? `Upload failed with ${response.status}`);

      const pages = payload.document.pageCount;
      const detail = pages ? `${pages} pages` : undefined;

      if (payload.outcome === "refused") {
        toast.error(`Refused: ${payload.document.failureReason?.replaceAll("_", " ")}`, {
          id: reading,
          description: payload.document.failureDetail ?? undefined,
        });
      } else if (payload.outcome === "reused") {
        toast.success("Already processed at this version", {
          id: reading,
          description: "Nothing to redo. Open it to read the facts.",
        });
      } else {
        toast.success(payload.outcome === "accepted" ? "Accepted" : "Reprocessing", {
          id: reading,
          description: detail ? `${detail}. Facts appear as pages finish.` : undefined,
        });
      }
      onUploaded();
    } catch (cause) {
      toast.error("Upload failed", {
        id: reading,
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 border border-border border-dashed px-5 py-6 transition-colors",
        dragging && "border-evidence bg-evidence-wash/40",
      )}
      onDragLeave={() => setDragging(false)}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) void upload(file);
      }}
    >
      <div className="min-w-0">
        <p className="font-medium">Drop a PDF here</p>
        <p className="mt-0.5 text-muted-foreground text-sm">
          A file already processed at this version comes straight back. A scan with no text layer is
          refused, with a reason.
        </p>
      </div>
      <Button disabled={busy} onClick={() => input.current?.click()} variant="outline">
        {busy ? "Checking" : "Choose a file"}
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
  );
}

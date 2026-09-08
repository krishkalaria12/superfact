"use client";

import type { EdgeVerdict } from "@superfact/db";
import type { PublishedAssertion, RejectedAssertion } from "@superfact/db/contracts";
import { Button } from "@superfact/ui/components/button";
import { useCallback, useEffect, useMemo, useState } from "react";

import { EdgeDetail, VerdictBadge } from "@/components/edge-detail";
import { FactDetail } from "@/components/fact-detail";
import { ProgressRail } from "@/components/progress-rail";
import {
  type EdgesResponse,
  type EdgeWithSides,
  type FactsResponse,
  getJson,
  type Progress,
} from "@/lib/api";

/**
 * The inspection workspace: facts, relationships, and failures over one document.
 *
 * It polls while a job is running and stops when there is nothing left to wait for. Polling rather
 * than a socket because facts land in the database batch by batch anyway — a request every couple
 * of seconds shows the same progressive fill with none of the connection handling.
 */

const VERDICTS = ["contradicts", "reconciles", "corroborates", "insufficient"] as const;
const POLL_MS = 2500;

type View = "facts" | "relationships" | "failures";
type Selection =
  | { kind: "fact"; value: PublishedAssertion | RejectedAssertion }
  | { kind: "edge"; value: EdgeWithSides }
  | null;

export function Workspace({ documentId }: { documentId: string }) {
  const [view, setView] = useState<View>("facts");
  const [verdict, setVerdict] = useState<EdgeVerdict | null>(null);
  const [facts, setFacts] = useState<FactsResponse | null>(null);
  const [rejected, setRejected] = useState<FactsResponse | null>(null);
  const [relationships, setRelationships] = useState<EdgesResponse | null>(null);
  const [selected, setSelected] = useState<Selection>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      const [published, refused, edges] = await Promise.all([
        getJson<FactsResponse>(`/api/documents/${documentId}/facts?limit=200`, signal),
        getJson<FactsResponse>(
          `/api/documents/${documentId}/facts?status=rejected&limit=200`,
          signal,
        ),
        getJson<EdgesResponse>(`/api/documents/${documentId}/edges?limit=200`, signal),
      ]);
      setFacts(published);
      setRejected(refused);
      setRelationships(edges);
      setError(null);
      return published.progress;
    },
    [documentId],
  );

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const progress: Progress = await load(controller.signal);
        // A null job means nothing is queued or running, so there is nothing left to poll for.
        if (progress.job) timer = setTimeout(tick, POLL_MS);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        timer = setTimeout(tick, POLL_MS * 2);
      }
    };

    void tick();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  const visibleEdges = useMemo(
    () => (relationships?.edges ?? []).filter((edge) => !verdict || edge.verdict === verdict),
    [relationships, verdict],
  );

  const counts = relationships?.counts;

  return (
    <div className="grid min-h-0 gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col gap-3">
        {facts && <ProgressRail progress={facts.progress} />}

        <nav className="flex gap-1 border-border border-b pb-2">
          <ViewTab active={view} label="Facts" onSelect={setView} value="facts">
            {facts?.total ?? 0}
          </ViewTab>
          <ViewTab active={view} label="Relationships" onSelect={setView} value="relationships">
            {relationships?.total ?? 0}
          </ViewTab>
          <ViewTab active={view} label="Failures" onSelect={setView} value="failures">
            {rejected?.total ?? 0}
          </ViewTab>
        </nav>

        {error && (
          <p className="border border-destructive/40 bg-destructive/5 p-2 text-destructive text-sm">
            {error}
          </p>
        )}

        {view === "relationships" && counts && (
          <div className="flex flex-wrap gap-1">
            <FilterChip active={verdict === null} onClick={() => setVerdict(null)}>
              all
            </FilterChip>
            {VERDICTS.map((value) => (
              <FilterChip
                active={verdict === value}
                key={value}
                onClick={() => setVerdict(verdict === value ? null : value)}
              >
                {value} {counts[value]}
              </FilterChip>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto border border-border">
          {view === "facts" && (
            <FactList
              facts={facts?.facts ?? []}
              onSelect={(value) => setSelected({ kind: "fact", value })}
              selectedId={selected?.kind === "fact" ? selected.value.id : null}
            />
          )}
          {view === "relationships" && (
            <EdgeList
              edges={visibleEdges}
              onSelect={(value) => setSelected({ kind: "edge", value })}
              selectedId={selected?.kind === "edge" ? selected.value.id : null}
            />
          )}
          {view === "failures" && (
            <FactList
              facts={rejected?.facts ?? []}
              onSelect={(value) => setSelected({ kind: "fact", value })}
              selectedId={selected?.kind === "fact" ? selected.value.id : null}
            />
          )}
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto">
        {selected === null ? (
          <p className="p-6 text-muted-foreground text-sm">
            Select a fact or a relationship to see the page region it rests on.
          </p>
        ) : selected.kind === "fact" ? (
          <FactDetail fact={selected.value} />
        ) : (
          <EdgeDetail edge={selected.value} />
        )}
      </div>
    </div>
  );
}

function FactList({
  facts,
  onSelect,
  selectedId,
}: {
  facts: readonly (PublishedAssertion | RejectedAssertion)[];
  onSelect: (fact: PublishedAssertion | RejectedAssertion) => void;
  selectedId: string | null;
}) {
  if (facts.length === 0) {
    return <p className="p-4 text-muted-foreground text-sm">Nothing here yet.</p>;
  }

  return (
    <ul>
      {facts.map((fact) => (
        <li key={fact.id}>
          <button
            className={`w-full border-border border-b px-3 py-2 text-left hover:bg-muted ${
              selectedId === fact.id ? "bg-muted" : ""
            }`}
            onClick={() => onSelect(fact)}
            type="button"
          >
            <span className="block truncate font-medium text-sm">{fact.subject}</span>
            <span className="block truncate text-muted-foreground text-xs">{fact.predicate}</span>
            <span className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-xs">{fact.rawValue}</span>
              <span className="text-muted-foreground text-xs">p{fact.page}</span>
              {fact.status === "rejected" && (
                <span className="text-destructive text-xs">
                  {fact.rejectionReason.replaceAll("_", " ")}
                </span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function EdgeList({
  edges,
  onSelect,
  selectedId,
}: {
  edges: readonly EdgeWithSides[];
  onSelect: (edge: EdgeWithSides) => void;
  selectedId: string | null;
}) {
  if (edges.length === 0) {
    return <p className="p-4 text-muted-foreground text-sm">No relationships of this kind.</p>;
  }

  return (
    <ul>
      {edges.map((edge) => (
        <li key={edge.id}>
          <button
            className={`w-full border-border border-b px-3 py-2 text-left hover:bg-muted ${
              selectedId === edge.id ? "bg-muted" : ""
            }`}
            onClick={() => onSelect(edge)}
            type="button"
          >
            <span className="flex items-center gap-2">
              <VerdictBadge verdict={edge.verdict} />
              {edge.priorPass && (
                <span className="text-chart-3 text-xs">was {edge.priorPass.verdict}</span>
              )}
            </span>
            <span className="mt-1 block truncate text-sm">
              {edge.source?.subject ?? "?"} ↔ {edge.target?.subject ?? "?"}
            </span>
            <span className="block truncate text-muted-foreground text-xs">
              {edge.reasonCode.replaceAll("_", " ")}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ViewTab({
  active,
  children,
  label,
  onSelect,
  value,
}: {
  active: View;
  children: React.ReactNode;
  label: string;
  onSelect: (view: View) => void;
  value: View;
}) {
  return (
    <Button
      onClick={() => onSelect(value)}
      size="sm"
      variant={active === value ? "secondary" : "ghost"}
    >
      {label}
      <span className="text-muted-foreground">{children}</span>
    </Button>
  );
}

function FilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`border px-2 py-0.5 text-xs ${
        active ? "border-foreground" : "border-border text-muted-foreground hover:text-foreground"
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

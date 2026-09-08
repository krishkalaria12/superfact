"use client";

import type { EdgeVerdict } from "@superfact/db";
import type { PublishedAssertion, RejectedAssertion } from "@superfact/db/contracts";
import { Input } from "@superfact/ui/components/input";
import { Skeleton } from "@superfact/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@superfact/ui/components/tabs";
import { cn } from "@superfact/ui/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { EdgeDetail } from "@/components/edge-detail";
import { DocumentOverview } from "@/components/document-overview";
import { FactDetail } from "@/components/fact-detail";
import { StageRail, StageRailSkeleton } from "@/components/stage-rail";
import { Cite, RefusalBadge, VerdictBadge } from "@/components/vocabulary";
import {
  type DocumentDetailsResponse,
  type EdgesResponse,
  type EdgeWithSides,
  type FactsResponse,
  getJson,
  type Progress,
} from "@/lib/api";

/**
 * The inspection workspace: facts, relationships, and refusals over one document.
 *
 * It polls while a run is going and stops the moment nothing is queued. Polling rather than a
 * socket because facts land in the database batch by batch anyway — a request every couple of
 * seconds shows the same progressive fill with none of the connection handling.
 *
 * The list and the detail are one instrument, not two panes that happen to be adjacent. Arrow keys
 * move down the list, because reviewing three hundred facts with a mouse is not reviewing.
 */

const VERDICTS: EdgeVerdict[] = ["contradicts", "reconciles", "corroborates", "insufficient"];
const POLL_MS = 2500;

type View = "facts" | "links" | "refused";
type Selection =
  | { kind: "fact"; value: PublishedAssertion | RejectedAssertion }
  | { kind: "edge"; value: EdgeWithSides }
  | null;

export function Workspace({ documentId }: { documentId: string }) {
  const [view, setView] = useState<View>("facts");
  const [verdict, setVerdict] = useState<EdgeVerdict | null>(null);
  const [query, setQuery] = useState("");
  const [facts, setFacts] = useState<FactsResponse | null>(null);
  const [refused, setRefused] = useState<FactsResponse | null>(null);
  const [links, setLinks] = useState<EdgesResponse | null>(null);
  const [details, setDetails] = useState<DocumentDetailsResponse | null>(null);
  const [selected, setSelected] = useState<Selection>(null);
  const [error, setError] = useState<string | null>(null);
  const announced = useRef({ started: false, firstFact: false, finished: false });

  const load = useCallback(
    async (signal: AbortSignal) => {
      const [published, rejected, edges, documentDetails] = await Promise.all([
        getJson<FactsResponse>(`/api/documents/${documentId}/facts?limit=300`, signal),
        getJson<FactsResponse>(
          `/api/documents/${documentId}/facts?status=rejected&limit=300`,
          signal,
        ),
        getJson<EdgesResponse>(`/api/documents/${documentId}/edges?limit=300`, signal),
        getJson<DocumentDetailsResponse>(`/api/documents/${documentId}`, signal),
      ]);
      setFacts(published);
      setRefused(rejected);
      setLinks(edges);
      setDetails(documentDetails);
      setError(null);
      return published;
    },
    [documentId],
  );

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const published = await load(controller.signal);
        const progress: Progress = published.progress;

        // Three moments worth interrupting a reader for, each announced once, and none of them on
        // a document that was already finished when the page opened — arriving at a completed run
        // and being told its facts have "just" landed is a lie the interface should not tell.
        if (progress.job && !announced.current.started) {
          announced.current.started = true;
          toast.info(`Reading ${published.document.filename}`);
        }
        if (announced.current.started && published.total > 0 && !announced.current.firstFact) {
          announced.current.firstFact = true;
          toast.success("First facts published", {
            description: "The list fills in while the rest of the document is still being read.",
          });
        }
        if (!progress.job && announced.current.started && !announced.current.finished) {
          announced.current.finished = true;
          toast.success(`${published.total} facts published`, {
            description: `${published.progress.pagesParsed} pages read.`,
          });
        }

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

  const needle = query.trim().toLowerCase();

  const visibleFacts = useMemo(() => {
    const source = (view === "refused" ? refused : facts)?.facts ?? [];
    if (!needle) return source;
    return source.filter((fact) =>
      `${fact.subject} ${fact.predicate} ${fact.rawValue} ${fact.evidence.quote}`
        .toLowerCase()
        .includes(needle),
    );
  }, [view, facts, refused, needle]);

  const visibleLinks = useMemo(() => {
    let source = links?.edges ?? [];
    if (verdict) source = source.filter((edge) => edge.verdict === verdict);
    if (!needle) return source;
    return source.filter((edge) =>
      `${edge.explanation} ${edge.source?.subject ?? ""} ${edge.target?.subject ?? ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [links, verdict, needle]);

  const rows = view === "links" ? visibleLinks : visibleFacts;
  const selectedId =
    selected?.kind === "fact"
      ? selected.value.id
      : selected?.kind === "edge"
        ? selected.value.id
        : null;

  const move = (delta: number) => {
    if (rows.length === 0) return;
    const at = rows.findIndex((row) => row.id === selectedId);
    const next = rows[Math.min(Math.max(at + delta, 0), rows.length - 1)] ?? rows[0];
    if (!next) return;
    setSelected(
      view === "links"
        ? { kind: "edge", value: next as EdgeWithSides }
        : { kind: "fact", value: next as PublishedAssertion },
    );
    document.getElementById(`row-${next.id}`)?.scrollIntoView({ block: "nearest" });
  };

  // A refused document and an unreadable page are failures the same way a refused claim is, and
  // the tab counts all three. Anything else would let a document that failed whole read as clean.
  const structural = (details?.document.failureReason ? 1 : 0) + (details?.failedPages.length ?? 0);

  // Switching tabs clears the selection: a fact stays open while the list beneath it changes to
  // relationships otherwise, which reads as the two panes having come apart.
  const selectView = (next: View) => {
    setView(next);
    setSelected(null);
  };

  const loading = facts === null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {facts === null ? (
        <StageRailSkeleton />
      ) : (
        <StageRail
          counts={{
            facts: facts.total,
            refused: refused?.total ?? 0,
            links: links?.total ?? 0,
          }}
          documentStatus={facts.document.status}
          progress={facts.progress}
        />
      )}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]">
        <div
          className="flex min-h-0 flex-col border-border border-r"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              move(1);
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              move(-1);
            }
          }}
        >
          <Tabs onValueChange={(value) => selectView(value as View)} value={view}>
            <TabsList
              className="h-9 w-full border-border border-b bg-transparent px-2"
              variant="line"
            >
              <Tab count={facts?.total} label="Facts" value="facts" />
              <Tab count={links?.total} label="Relationships" value="links" />
              <Tab count={(refused?.total ?? 0) + structural} label="Refused" value="refused" />
            </TabsList>
          </Tabs>

          <div className="space-y-2 border-border border-b p-2">
            <Input
              onChange={(event) => setQuery(event.target.value)}
              placeholder={view === "links" ? "Search explanations" : "Search subjects and quotes"}
              value={query}
            />
            {view === "links" && links && (
              <div className="flex flex-wrap gap-1">
                <Chip active={verdict === null} onClick={() => setVerdict(null)}>
                  all {links.total}
                </Chip>
                {VERDICTS.map((value) => (
                  <Chip
                    active={verdict === value}
                    key={value}
                    onClick={() => setVerdict(verdict === value ? null : value)}
                  >
                    {value} {links.counts[value]}
                  </Chip>
                ))}
              </div>
            )}
          </div>

          {error && (
            <p className="border-destructive/30 border-b bg-destructive/5 p-2 text-destructive text-sm">
              {error}
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <ListSkeleton />
            ) : view === "links" ? (
              <LinkList
                edges={visibleLinks}
                onSelect={(value) => setSelected({ kind: "edge", value })}
                query={needle}
                selectedId={selectedId}
              />
            ) : (
              <>
                {view === "refused" && details && <StructuralFailures details={details} />}
                <FactList
                  facts={visibleFacts}
                  onSelect={(value) => setSelected({ kind: "fact", value })}
                  query={needle}
                  selectedId={selectedId}
                  waiting={Boolean(facts?.progress.job)}
                />
              </>
            )}
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto">
          {selected === null ? (
            facts ? (
              <DocumentOverview
                facts={facts}
                links={links}
                onPickVerdict={(value) => {
                  setView("links");
                  setVerdict(value);
                }}
                refused={refused}
              />
            ) : null
          ) : (
            <div className="mx-auto max-w-4xl p-6">
              {selected.kind === "fact" ? (
                <FactDetail fact={selected.value} />
              ) : (
                <EdgeDetail edge={selected.value} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Tab({ count, label, value }: { count: number | undefined; label: string; value: string }) {
  return (
    <TabsTrigger className="flex-1 text-sm" value={value}>
      {label}
      <span className="font-mono text-muted-foreground text-xs">{count ?? "—"}</span>
    </TabsTrigger>
  );
}

/**
 * Failures that are not claims: a document refused whole, or a page nothing could be read from.
 *
 * They lead the refused list because they explain absences the claim list cannot. A page that
 * failed to parse produces no rejected assertions at all, so without this the only evidence of it
 * is a gap in the page numbers.
 */
function StructuralFailures({ details }: { details: DocumentDetailsResponse }) {
  const documentFailure = details.document.failureReason;
  if (!documentFailure && details.failedPages.length === 0) return null;

  return (
    <ul className="border-border border-b bg-destructive/5">
      {documentFailure && (
        <li className="border-border border-b px-3 py-2 last:border-b-0">
          <span className="block font-medium text-destructive text-sm">
            The whole document: {documentFailure.replaceAll("_", " ")}
          </span>
          {details.document.failureDetail && (
            <span className="mt-0.5 block text-muted-foreground text-xs">
              {details.document.failureDetail}
            </span>
          )}
        </li>
      )}
      {details.failedPages.map((page) => (
        <li className="border-border border-b px-3 py-2 last:border-b-0" key={page.page}>
          <span className="flex items-baseline justify-between gap-2">
            <span className="font-medium text-destructive text-sm">
              {(page.reason ?? "unknown failure").replaceAll("_", " ")}
            </span>
            <Cite>p{page.page}</Cite>
          </span>
          {page.detail && (
            <span className="mt-0.5 block text-muted-foreground text-xs">{page.detail}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function FactList({
  facts,
  onSelect,
  query,
  selectedId,
  waiting,
}: {
  facts: readonly (PublishedAssertion | RejectedAssertion)[];
  onSelect: (fact: PublishedAssertion | RejectedAssertion) => void;
  query: string;
  selectedId: string | null;
  waiting: boolean;
}) {
  if (facts.length === 0) {
    return (
      <Empty>
        {query
          ? "Nothing matches that search."
          : waiting
            ? "No facts yet. They appear here as each batch of pages finishes."
            : "This document produced no facts."}
      </Empty>
    );
  }

  return (
    <ul>
      {facts.map((fact) => (
        <li id={`row-${fact.id}`} key={fact.id}>
          <button
            className={cn(
              "w-full border-border border-b px-3 py-2 text-left transition-colors hover:bg-muted/60",
              selectedId === fact.id && "bg-muted",
            )}
            onClick={() => onSelect(fact)}
            type="button"
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate font-medium text-sm">{fact.subject}</span>
              <Cite>p{fact.page}</Cite>
            </span>
            <span className="mt-0.5 flex items-baseline gap-2">
              <span className="shrink-0 font-mono text-sm">{fact.rawValue}</span>
              <span className="truncate text-muted-foreground text-xs">{fact.predicate}</span>
            </span>
            {fact.status === "rejected" && (
              <span className="mt-1 block">
                <RefusalBadge reason={fact.rejectionReason} />
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function LinkList({
  edges,
  onSelect,
  query,
  selectedId,
}: {
  edges: readonly EdgeWithSides[];
  onSelect: (edge: EdgeWithSides) => void;
  query: string;
  selectedId: string | null;
}) {
  if (edges.length === 0) {
    return (
      <Empty>
        {query ? "Nothing matches that search." : "No relationships of this kind in this document."}
      </Empty>
    );
  }

  return (
    <ul>
      {edges.map((edge) => (
        <li id={`row-${edge.id}`} key={edge.id}>
          <button
            className={cn(
              "w-full border-border border-b px-3 py-2 text-left transition-colors hover:bg-muted/60",
              selectedId === edge.id && "bg-muted",
            )}
            onClick={() => onSelect(edge)}
            type="button"
          >
            <span className="flex items-center gap-2">
              <VerdictBadge verdict={edge.verdict} />
              {edge.priorPass && (
                <Cite className="text-verdict-reconciled">was {edge.priorPass.verdict}</Cite>
              )}
            </span>
            <span className="mt-1 block truncate text-sm">{edge.source?.subject ?? "unknown"}</span>
            <span className="block truncate text-muted-foreground text-sm">
              {edge.target?.subject ?? "unknown"}
            </span>
            <span className="mt-0.5 block truncate font-mono text-muted-foreground text-xs">
              {edge.reasonCode.replaceAll("_", " ")}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-4 text-muted-foreground text-sm">{children}</p>;
}

function ListSkeleton() {
  return (
    <div>
      {Array.from({ length: 8 }, (_, index) => (
        <div className="space-y-2 border-border border-b px-3 py-2.5" key={index}>
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3.5 w-24" />
        </div>
      ))}
    </div>
  );
}

function Chip({
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
      className={cn(
        "border px-2 py-0.5 text-xs transition-colors",
        active
          ? "border-foreground text-foreground"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

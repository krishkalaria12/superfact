# Superfact

Evidence-first fact knowledge layer for PDFs. `docs/implementation-plan.html` is the
source of truth for scope and sequencing. Read it before adding anything structural.

## Writing

Use the unslop skill for everything you write: replies, commit messages, comments, docs. It
always applies.

## Invariants

These break the product if violated:

- **Nothing publishes without verbatim evidence.** An assertion's quote must be findable in the
  stored page text and its cited line IDs must exist. Deterministic check, no model involved.
- **Assertions are immutable and per-occurrence.** One row per document mention, even when two
  documents say the identical thing. Interpretation lives in `edges`, never by mutating a row.
- **Four verdicts only:** `corroborates | contradicts | reconciles | insufficient`. Nuance goes in
  `reasonCode`, not in new enum values. `PublishedAssertion` types `verified` and `contextComplete`
  as `true` rather than `boolean`, so an ungrounded fact cannot be constructed.
- **Never emit `contradicts`** without evidence from both sides and a demonstration that the
  decisive context (time, scope, unit, attribution) actually matches.
- **No document-specific logic.** No hard-coded facts, filenames, predicates, or branches.
  Reviewers test with PDFs we have not seen.
- **Table cells carry their context.** A number becomes an assertion only with its table title,
  column header, row header, and unit attached.

## Deliberately absent

Do not add these back without asking: Python or any second service, OCR, a second PDF parser,
browser-side PDF.js, accuracy metrics, gold sets, or benchmark evaluation. Each was considered and
cut, and the plan's changelog says why.

Models are named in the plan and pinned in code: `gpt-5.6-luna` extracts, `gpt-5.6-terra` adjudicates,
Terra at `reasoningEffort: "high"` runs the contradiction second pass, and `text-embedding-3-small`
serves retrieval. Escalation answers to one condition — a first pass that said `contradicts` — and
never to a general risk score.

Parsing is `mupdf` (WASM) in-process. The evidence viewer draws boxes on stored page rasters using
the coordinates the parser emitted, so parser and viewer share one coordinate space. Rasters are
grayscale PNG at `RASTER_SCALE` (2×), and the scale is written to the page row rather than assumed
— a stored bbox times that number is the box on screen. Changing the constant must not silently
misplace highlights over pages rendered before the change.

## Logging

evlog, configured in `apps/web/src/lib/evlog.ts`. Wide events, not log lines: a handler wrapped in
`withEvlog` accumulates context through `useLogger().set()` and emits one event when the request
finishes. Never use `console.log`.

Every event about a run carries `job.id` and `job.stages`. `stages` is a list because Inngest
checkpoints several steps into one HTTP request, and one wide event covers that whole request — a
scalar would keep only the last stage of the batch. Add a field to `SuperfactFields` before setting
it; the type is enforced.

`log.fork()` is not usable for stage work. It is fire-and-forget and swallows the error, so a
failing stage would report success.

## Layout

`apps/web` (app, API, jobs) · `packages/db` (Drizzle schema) · `packages/env` (validated env) ·
`packages/ui` (shared shadcn primitives, imported as `@superfact/ui/*`) · `packages/config`.

Five tables: `documents`, `pages`, `assertions`, `edges`, `jobs`. All five are filled by a run.

Zod contracts live beside the schema in `packages/db/src/contracts`, imported as
`@superfact/db/contracts`. Enum values are declared once as `pgEnum`s in the schema and the
contracts derive from them, so a verdict or reason code cannot drift between the column and the
JSON. `@superfact/db/projection` is the only place a row and its contract shape meet — both
directions, so a lost field is a diff rather than a silent gap in an export.

Import Drizzle operators from `@superfact/db/orm`, never from `drizzle-orm` directly. A second copy
of the package in the tree yields two incompatible sets of column types.

An environment variable is required only from the phase that first reads it. `DATABASE_URL` and
`UPLOADTHING_TOKEN` are both required now — uploads are the only way a document enters the system,
so the app is inert without storage. `apps/web/.env.example` records which phase claims each one.

Embeddings are `text-embedding-3-small` at 1536 dimensions, over subject and predicate text only.
They serve retrieval in candidate pairing and nothing else: a verdict never rests on similarity, and
numbers never go through vectors — ₹7,225 crore and ₹72.25 billion are a coin flip in vector space.
The dimension is fixed in the schema, so changing the model means a migration and a full re-embed.

They are written by the `relate` stage, not by `extract`. A vector is a retrieval index derived from
two immutable columns, so filling one in is not the kind of mutation the immutability invariant
forbids — and the stage that reads it is the honest place to build it. The backfill covers every
published assertion at the pipeline version, not only the focus document's, because a neighbour
without a vector is invisible to the semantic path and would stay unpairable until something
happened to re-run it.

Files live in UploadThing. It assigns its own `{uuid}_{filename}` key and will not take a path, so
anything a stage may re-upload needs a `customId` derived from content hash and page index —
otherwise a retry orphans a duplicate instead of overwriting. Ids are minted in
`apps/web/src/lib/storage.ts`; nothing constructs one inline.

**Never delete a stored object to rewrite it.** UploadThing tombstones a deleted `customId`: it
keeps answering `409 File already exists` while being absent from both `listFiles` and
`getFileUrls`, so the id can never be written again and nothing can read what used to be there.
There is no upsert, so `putObject` reuses whatever is already stored under the id — safe, because
the id is derived from the bytes — and falls back to a suffixed id when it meets a tombstone left
by something else. `removeObjects` is one-way; treat it as destroying the id, not just the file. This replaced Vercel Blob after the plan was written; the plan's revision-2
changelog used to list UploadThing as cut.

`apps/web/src/lib/parse` is the parse stage. A MuPDF "line" on a table page is one cell, not one
visual row, which is the granularity everything else is built on: a row is whatever cells share a
baseline, a column is whatever cells overlap horizontally. Three rules earn their keep and should
not be undone casually:

- **Bands before rows.** A band boundary is the complement of merged line coverage. A two-up
  landscape spread splits at its gutter; an ordinary table does not, because its own title spans
  the inter-column gaps and closes them. No special case tells the two apart.
- **Columns from body rows only.** Overlap is transitive, so a heading spanning three columns
  merges all three. Data cells never span, so the body is the only trustworthy source.
- **A ragged table emits no rows.** A malformed grid attaches real numbers to the wrong header,
  and the evidence gate cannot catch that because the quote is genuine. The band keeps its box and
  its raster for a vision read instead.

Table context comes from typographic convention, never from content: the title is the largest-type
line above the table in its band (proximity picks the registration number on the Delhivery balance
sheet), and the unit line is a fully parenthesised line above it. The unit must come from there —
on the Delhivery notes the rupee glyph is missing from the font's encoding map and decodes as `I`,
so the character in the cell says nothing.

`apps/web/src/lib/pairing` is the `relate` stage's retrieval half. Two paths run as one SQL
statement each and their results are unioned: the **deterministic** path self-joins `assertions` on
equal canonical value, which is exact because phase 05 already converted the scales; the
**semantic** path is a `cross join lateral` top-k over pgvector, exact search with no HNSW index.
Both hand back nothing but ids. Everything that decides what a match _means_ — predicate
relatedness, value-type compatibility, unit comparability, the cap — lives in `buildCandidatePairs`,
which is pure and unit-tested, because "known pairs never reach the adjudicator" is this phase's
named risk and it is not a thing you can eyeball in a query plan.

Three rules there are load-bearing:

- **The prefilter never drops on time, unit, or scope.** Those differences are what reconciliation
  explains; a filter that removed them would leave the adjudicator only the easy pairs. It drops on
  incompatible value types and on predicates too unrelated to be discussing the same thing, and
  nothing else.
- **A value match outranks every semantic neighbour.** Scores are banded so the deterministic floor
  sits above the semantic ceiling, which means the cap can never cut an exact canonical match to
  make room for a close-sounding one.
- **Pairs are cross-document only.** A document restating its own number costs the same
  adjudication budget and reconciles nothing. Each run pairs one document against everything else
  stored, so a cross-document pair is discovered once, by whichever document arrived second.

Pairs are never stored. They are an intermediate the `stage:relate:pairs` step computes and hands
straight to the adjudicators, so the stage logs its counts and `GET /api/documents/:id/pairs`
recomputes them on demand — two queries, no model call. Read `capped` and `dropped` in the log
before trusting a quiet run: a cap that keeps firing is starving the adjudicator.

`apps/web/src/lib/adjudication` is the second half of `relate`. `compare.ts` is pure and runs first:
it decides what actually differs between two assertions across subject, predicate, time, scope,
unit, value, modality, and attribution. Every field lands in `matched`, `mismatched`, or `unknown`,
and that third bucket is load-bearing — "these periods differ" and "one of these has no period" are
different situations, and merging them would let a contradiction be declared over a qualifier nobody
compared.

Four rules hold the phase together:

- **Code owns what differs; the model owns what it means.** A mismatch `compare.ts` found cannot be
  talked away by the model. The model may only add a match for a field code left `unknown`, and
  only from the two evidence quotes.
- **`contradicts` is enforced, not accepted.** It survives only when `value` is mismatched and all
  five of `DECISIVE_FIELDS` are matched. Otherwise it is rewritten to `insufficient` with a code
  naming what stopped it, and the count lands in the log as `withheld`. This is the invariant that
  AGENTS.md states as a rule and this is where it is a code path.
- **Only `contradicts` escalates.** The second pass runs Terra at high reasoning effort with the
  burden reversed — argue these are reconcilable — and it is the sole escalation condition. That
  keeps the expensive call to tens of pairs rather than thousands.
- **A downgrade keeps both readings.** When the review finds a decisive qualifier the edge becomes
  `reconciles` and the first pass survives in `priorVerdict`/`priorExplanation`. It is the most
  persuasive thing the product shows and it is only legible if both passes stay.

Deterministic settlement is the cost control: a pair that agrees on value and on all five decisive
fields is written as `corroborates` with no model call at all. Settling demands every decisive field
be _positively_ matched, never merely un-mismatched — two claims scoped along axes that never meet
(one `segment`, one `geography`) read as `unknown`, and asking costs one call where a wrong
corroboration costs the reviewer's trust.

Edge direction carries meaning, so the writer picks it: for `time_supersession`, `vintage_difference`,
and `projection_vs_actual` the source is the side that wins — the later period, or the observation
over the forecast. Other codes order by id, arbitrary but stable, so the same pair lands on one row
whichever document's run reaches it. Writes are an upsert on the ordered pair, which is what makes a
batch retry safe after the stage cleared its edges once.

A pair whose model call keeps failing is recorded as a skip and named in the wide event rather than
failing the batch. One flaky call should not cost a document every relationship it has, and a skip
that is counted, logged, and returned by the edges endpoint is not a swallowed failure.

Intake is hash, refuse, store, enqueue, in that order — `apps/web/src/lib/documents.ts`. Hashing
first means a known file costs one index lookup; validating second means a scan or a corrupt file
never reaches storage. `inspectPdf` opens the document, checks for a password, and samples up to
twelve pages spread across it, refusing below a median of 120 characters per page. That is the
whole of phase 02's parsing — phase 03 opens the document again for geometry.

Every pipeline stage clears its own output for the document at the current pipeline version before
producing any. Inngest replays completed steps on a later attempt, so a stage that appended would
double its output; clearing first makes a retry idempotent without every future stage remembering
to check.

Extraction runs densest page first. Parsing has already mapped the document, so
`apps/web/src/lib/extract/priority.ts` ranks pages on resolved table cells, a summary-ish heading,
and text length, and the batches go out in that order. It changes the order and never the set — a
run's output is identical whichever order it ran in — and what it buys is that a reviewer watching
the fact list sees financial tables fill in while body prose is still going. Extraction batches
therefore carry a list of page numbers rather than a range, and those numbers are one-based to match
`pages` rows where the parse events are zero-based to match MuPDF.

The heading list in that file is ordinary English section words. It is the closest the codebase
comes to knowing what a document says, so keep it short: a longer list starts encoding what we
expect these six PDFs to contain, which is the demo-overfitting risk the plan names.

Parse fans out: the stage plans page ranges and `step.invoke`s `parse-page-batch` once per range,
so each range is its own function run with its own request budget. Splitting it into steps would
not have worked — Inngest checkpoints several steps of one function into a single request, and the
deployment target caps how long that may run. At roughly a second a page, a long document does not
fit in one. `PAGES_PER_BATCH` times `CHUNK` times the batch concurrency limit is what the storage
provider sees at once; raising any of them raises that product.

## Commands

`pnpm dev` (Next.js on 3001 and the Inngest dev server on 8288) · `pnpm check-types` ·
`pnpm check` (Oxlint + Oxfmt) · `pnpm db:push`.

`db:push` creates the pgvector extension first, because drizzle-kit does not manage extensions and
`assertions.embedding` is `vector(1536)`.

`docs/starter-datasets/` holds the six starter PDFs, 511 pages. They are the tuning surface: the
plan has no gold set, so parser and prompt changes are judged by re-reading output over the same
fixed pages.

Work is never repeated. `POST /api/documents` hashes first, so a file already processed at the
current pipeline version comes back `reused` after one index lookup — no parse, no extraction, no
model call. A new document pairs against what is already stored and never rebuilds it: `pairDocument`
takes one focus document against the rest of the corpus, so adding a fourth PDF costs the fourth
PDF. Only a `PIPELINE_VERSION` change invalidates that, and it invalidates everything at once.

One gap worth knowing: a job that failed partway re-parses the document from scratch, because
`pages` rows carry no pipeline version and so cannot be told apart from a previous version's. Fixing
it means a column; nothing in the plan's exit checks needs it yet.

`POST /api/documents` takes a multipart `file` field and answers with one of four outcomes:
`accepted`, `reused`, `reprocessing`, or `refused`. A refusal is a 200 carrying a reason code, not
an error — refusing a scan is the system working. `GET /api/documents/:id` and `GET /api/jobs/:id`
are read-only and both report per-page coverage.

`GET /api/documents/:id/facts` answers mid-run, which is the point of it. Each extraction batch
commits its rows as it finishes, so a client polling this watches facts arrive while later pages are
still being read. `progress` travels in the same response because forty facts means something
different at page 12 of 400 than at the end, and `progress.job` going null is how a caller knows to
stop polling. `?status=rejected` returns what the grounding gate refused, with reason codes.

`GET /api/documents/:id/pairs` is the phase 06 exit check: it recomputes candidate pairing for one
document and answers with each pair's two assertions in full, the retrieval paths that found it, and
what the prefilter and the cap excluded. `limit` defaults to 100.

`GET /api/documents/:id/edges` is the phase 07 exit check: every judged relationship touching the
document, contradictions first, each with both claims attached and the fields that matched and did
not. `?verdict=contradicts` narrows to the four cases the demo turns on.

`POST /api/dev/round-trip` is the phase 01 exit check: it writes a hand-written page, two published
assertions, a rejection, and an edge, projects them into the JSON export, and diffs the result
against what went in — non-empty `differences` means a field is being lost. It cleans up after
itself and refuses in production.

`pnpm --filter web test` runs the node:test suites over normalization, candidate pairing,
adjudication, and extraction priority — the places where a rule is cheaper to test than to inspect. They run under plain
`node --test`, which is why every relative import inside `packages/db` carries an explicit `.ts`
extension: node's ESM resolver will not guess one, and the contracts are imported for real rather
than as types.

Run `pnpm check` and `pnpm check-types` before calling work done.

## Note

`apps/web/AGENTS.md` is generated by `next dev` and re-added if deleted. Leave it alone.

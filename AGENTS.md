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

Five tables: `documents`, `pages`, `assertions`, `edges`, `jobs`. Only `assertions` and `edges` are
still empty; phase 04 fills them.

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

Files live in UploadThing. It assigns its own `{uuid}_{filename}` key and will not take a path, so
anything a stage may re-upload needs a `customId` derived from content hash and page index —
otherwise a retry orphans a duplicate instead of overwriting. There is no upsert, so `putObject`
deletes the `customId` before writing it. Ids are minted in `apps/web/src/lib/storage.ts`; nothing
constructs one inline. This replaced Vercel Blob after the plan was written; the plan's revision-2
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

Intake is hash, refuse, store, enqueue, in that order — `apps/web/src/lib/documents.ts`. Hashing
first means a known file costs one index lookup; validating second means a scan or a corrupt file
never reaches storage. `inspectPdf` opens the document, checks for a password, and samples up to
twelve pages spread across it, refusing below a median of 120 characters per page. That is the
whole of phase 02's parsing — phase 03 opens the document again for geometry.

Every pipeline stage clears its own output for the document at the current pipeline version before
producing any. Inngest replays completed steps on a later attempt, so a stage that appended would
double its output; clearing first makes a retry idempotent without every future stage remembering
to check.

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

`POST /api/documents` takes a multipart `file` field and answers with one of four outcomes:
`accepted`, `reused`, `reprocessing`, or `refused`. A refusal is a 200 carrying a reason code, not
an error — refusing a scan is the system working. `GET /api/documents/:id` and `GET /api/jobs/:id`
are read-only and both report per-page coverage.

`POST /api/dev/round-trip` is the phase 01 exit check: it writes a hand-written page, two published
assertions, a rejection, and an edge, projects them into the JSON export, and diffs the result
against what went in — non-empty `differences` means a field is being lost. It cleans up after
itself and refuses in production.

Run `pnpm check` and `pnpm check-types` before calling work done.

## Note

`apps/web/AGENTS.md` is generated by `next dev` and re-added if deleted. Leave it alone.

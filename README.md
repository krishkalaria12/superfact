# Superfact

An evidence-first fact knowledge layer for PDFs. It extracts atomic assertions, binds each one to
the exact region of the page it came from, and works out where facts corroborate, contradict, or
only look like they contradict until you compare their context.

Built for the Superjoin engineering intern assignment (`docs/superjoin.pdf`). The implementation
plan is `docs/implementation-plan.html` and remains the source of truth for scope and sequencing.

## What it does

Upload a PDF. The system parses it into text with per-line geometry, reconstructs its tables from
coordinates, extracts atomic claims, refuses any claim whose quote it cannot find on the page,
normalizes the values that survive, and then asks how each new fact relates to everything already
stored.

The thing worth looking at is what it refuses. A fact is published only if a deterministic check
finds its quote character-for-character in the stored page text and the lines it cites exist. A
contradiction is published only if the values genuinely differ _and_ the time, scope, unit,
modality, and attribution were all shown to be the same first — and then only if a second model
pass, told to argue the two are reconcilable, fails to find a qualifier that does it.

## Setup and run instructions

```bash
pnpm install
cp apps/web/.env.example apps/web/.env   # fill in DATABASE_URL, OPENAI_API_KEY, UPLOADTHING_TOKEN
pnpm db:push
pnpm dev
```

`pnpm dev` starts the app on http://localhost:3001 and the Inngest dev server on
http://localhost:8288. Neither Inngest key is needed locally.

OpenAI is the default. To run the same pipeline with Gemini, set these two values instead:

```bash
AI_PROVIDER=gemini
GOOGLE_GENERATIVE_AI_API_KEY=your-google-ai-studio-key
```

Create the key in [Google AI Studio](https://aistudio.google.com/app/apikey). The inactive
provider's key is optional. Switching providers changes the pipeline version, so stored documents
must be reprocessed before they appear in the current export. Embeddings from different models
cannot be compared safely.

Then drop a PDF on the home page. Facts appear while later pages are still being read.

The six starter PDFs live under `docs/starter-datasets/` locally but are not committed — they are
not mine to redistribute. `samples/` holds output from a real run over them instead, so the system's
behaviour is readable without credentials or the source files.

| Where            | What                                                          |
| ---------------- | ------------------------------------------------------------- |
| `/`              | Upload, and every document with its coverage                  |
| `/documents/:id` | Facts, relationships, and failures, with evidence on the page |
| `/cases`         | The four assignment cases, selected from output by query      |
| `/api/export`    | The whole run as JSON, validated against its own contract     |

## Approach

### How it works

Three durable stages per document — parse, extract, relate — each idempotent, each fanned out into
child function runs so no single request has to carry a long document.

**Parse** is MuPDF.js in-process, no OCR and no second parser. It emits per-line geometry and a
grayscale page raster at a recorded scale. Tables are reconstructed from coordinates rather than
from ruling lines, because none of the starter documents draws its tables. Three rules earn their
keep: split a page into column bands before clustering rows, so a two-up spread does not interleave;
take column boundaries from body rows only, since headings span and data cells never do; and emit no
rows at all for a ragged table, because a malformed grid attaches real numbers to the wrong header
and the evidence gate cannot catch that — the quote is genuine.

**Extract** runs densest page first. Parsing has already mapped the document, so extraction spends
its early batches on pages with tables and summary headings, which is what puts real facts on screen
while body prose is still going. The model proposes claims and cites line IDs; it is never asked for
anything code can decide.

**Ground** is where most candidates die, and that is the design. The verbatim gate looks for the
quote in the stored page text. A context gate rejects a revenue figure with no period or a growth
rate with no geography. Then normalization converts currencies, scales, percentages, units, and
fiscal periods in code, never by model, keeping the raw value beside the canonical one and recording
which rule did the conversion.

**Relate** retrieves candidate pairs two ways and unions them. A deterministic path self-joins on
equal canonical value — exact, because normalization already happened, which is why ₹7,225 crore and
₹72.25 billion match here and are a coin flip in vector space. A semantic path does top-k over
pgvector on subject and predicate text only; numbers never go through vectors. A pure, tested
prefilter then decides which pairs are worth a model call, and it deliberately never drops a pair
because time, unit, or scope differ — those differences are the reconciliations the next stage
exists to explain.

**Adjudicate** compares the pair in code first, then asks a model to interpret what code found. Code
owns what differs; the model owns what it means and may only fill a gap code could not compare.

### Stack

| Concern | Choice                                                                           |
| ------- | -------------------------------------------------------------------------------- |
| App     | Next.js App Router, TypeScript                                                   |
| Parsing | MuPDF.js (`mupdf`, WASM). Structured text, geometry, page rasters                |
| Models  | OpenAI GPT-5.6 Luna/Terra by default; Gemini 3.8 Flash when selected             |
| Vectors | OpenAI `text-embedding-3-small` or `gemini-embedding-2`, both at 1536 dimensions |
| Jobs    | Inngest. Stages: parse, extract, relate                                          |
| Logs    | evlog. One wide event per request, drained to `.evlog/logs` as NDJSON            |
| Data    | Neon PostgreSQL + pgvector, Drizzle ORM                                          |
| Files   | UploadThing                                                                      |
| UI      | Tailwind, shadcn/ui via `packages/ui`                                            |

Everything runs in one TypeScript process. No Python service, no OCR, no second parser.

### AI tools used

The code was written with Claude Code (Opus) working against `docs/implementation-plan.html`, phase
by phase, with each phase's exit check run before the next began. The plan itself was drafted and
then cut down hard: revision 1 had thirteen tables, seven verdicts, a Python parsing service, and an
accuracy harness. Revision 2 has five tables, four verdicts, one parser, and no benchmark. The
changelog at the bottom of the plan says why each thing went.

With the default provider, `gpt-5.6-luna` extracts and `gpt-5.6-terra` adjudicates. With Gemini,
`gemini-3.8-flash` does both jobs. The selected model uses high reasoning only for a contradiction
second pass. `text-embedding-3-small` is the OpenAI embedding model and `gemini-embedding-2` is the
Gemini model. Both write 1536 dimensions to the existing pgvector column.

## Limitations and next steps

### What does not work yet

**There is no measured accuracy, and no claim of any.** The plan cut gold sets, benchmark datasets,
and evaluation phases deliberately: labelling a corpus well enough for the numbers to mean anything
was more work than building the thing, and a number nobody can defend is worse than no number.
Quality is judged by re-reading output over the same fixed starter pages after each change. That is
a real weakness and the first thing I would fix with more time.

**Recall is traded away for precision, on purpose.** A large share of extracted candidates are
refused, most often because a value could not be normalized or a claim lacked the context its
predicate demands. Every refusal is stored with a reason code and visible in the failures view —
none are silently dropped — but the system would rather publish nothing than publish a number it
cannot stand behind.

**Scanned PDFs are refused outright.** There is no OCR. A document with no text layer is refused
whole rather than half-parsed into assertions nothing can ground.

**Table facts inherit poor subjects.** A cell whose row header the parser could not resolve becomes
an assertion with a subject like "unlabeled row", which is honest about what was read but of little
use to a reviewer. The context is still attached and the evidence still points at the right cell;
the naming is what suffers.

**A ragged table emits no rows.** When the geometry does not resolve into a clean grid, the band
keeps its bounding box and its raster and produces nothing, because wrong numbers under the right
header are worse than no numbers.

**A failed run re-parses from scratch.** Page rows carry no pipeline version, so they cannot be told
apart from a previous version's and are rebuilt. Re-uploading an already-processed file is cheap;
resuming a half-finished one is not.

**Chart-only pages produce nothing.** Vision extraction was cut. A page whose content is a chart the
parser cannot read contributes no facts and reports as low-density in its page quality.

### What I would build next

- A page-level pipeline version, so a failed run resumes instead of re-parsing.
- Measured accuracy over a small hand-labelled slice, which would let the prefilter thresholds and
  the similarity floor be tuned against something other than judgement.
- Splitting an extraction batch and retrying its halves when a response comes back unparseable,
  which adapts to how much a section actually yields instead of guessing a batch size.
- Better subjects for table facts, by preferring the row header over a generated cell label.
- Full-text search as a third retrieval path, but only after pairs are visibly being missed.
- An HNSW index, but only after exact vector search is measurably slow.

## Video demo

Not recorded. The system runs locally from the instructions above, and `samples/` holds real output
so its behaviour can be read without credentials.

## Additional notes

**Two of the four cases are currently empty, and the page says so.** `/cases` picks each example by
query over whatever the system produced. Two Delhivery documents from different fiscal years share
almost no directly comparable figures, so the corpus has produced reconciliations but no
corroboration or surviving contradiction. Processing the FY24 annual report alongside the FY24
earnings presentation is what would fill them; that document's run is the one still failing.

**The tuning has one round of evidence behind it, not many.** Every threshold — the similarity
floor, the pair caps, the rounding tolerance, the prose batch size — was set from reading output
over the starter PDFs once or twice. They are judgements, not measurements, and the README says so
in more detail under limitations.

**Read `AGENTS.md` for the reasoning.** It carries the invariants, what was deliberately left out
and why, and the explanations for the parts of the code that look strange — the column-band split
in the parser, the tombstone behaviour in storage, why embeddings are written by the relate stage.

## Layout

```
superfact/
├── apps/web/          # Next.js app: API routes, jobs, pipeline stages, UI
├── packages/db/       # Drizzle schema, Zod contracts, projection, ORM re-exports
├── packages/env/      # Validated environment contracts
├── packages/ui/       # Shared shadcn/ui primitives
├── packages/config/   # Shared tsconfig base
├── samples/           # Exported JSON and page images from a real run
└── docs/              # Assignment, implementation plan, starter PDFs
```

`AGENTS.md` is the working notes: invariants, what was deliberately left out, and the reasoning
behind the parts that look odd.

## Scripts

| Command                  | Does                                                          |
| ------------------------ | ------------------------------------------------------------- |
| `pnpm dev`               | Start Next.js and the Inngest dev server                      |
| `pnpm build`             | Build all workspaces                                          |
| `pnpm check-types`       | Typecheck across workspaces                                   |
| `pnpm check`             | Oxlint + Oxfmt                                                |
| `pnpm --filter web test` | node:test over normalization, pairing, adjudication, priority |
| `pnpm db:push`           | Push schema to the database                                   |
| `pnpm db:studio`         | Open Drizzle Studio                                           |

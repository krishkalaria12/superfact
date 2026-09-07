# Superfact

An evidence-first fact knowledge layer for PDFs. It extracts atomic assertions, binds each one to
the exact region of the page it came from, and identifies where facts corroborate, contradict, or
only appear to contradict until you compare their context.

Built for the Superjoin engineering intern assignment (`docs/superjoin.pdf`). The implementation
plan is `docs/implementation-plan.html`.

## Status

Phase 00 complete. The workspaces, environment contracts, job table, and durable job spine are
wired: a job moves through parse, extract, and relate as placeholder stages, and one job ID is
visible in both the database and the logs. Parsing, extraction, and adjudication are not built.

## Stack

| Concern | Choice                                                                               |
| ------- | ------------------------------------------------------------------------------------ |
| App     | Next.js App Router, TypeScript                                                       |
| Parsing | MuPDF.js (`mupdf`, WASM). Structured text, geometry, page rasters                    |
| Models  | GPT-5.6 Luna (extraction), Terra (adjudication), Terra high (contradiction re-check) |
| Jobs    | Inngest. Stages: parse, extract, relate                                              |
| Logs    | evlog. One wide event per request, drained to `.evlog/logs` as NDJSON                |
| Data    | Neon PostgreSQL + pgvector, Drizzle ORM                                              |
| Files   | Vercel Blob                                                                          |
| UI      | Tailwind, shadcn/ui via `packages/ui`                                                |

Everything runs in one TypeScript process. There is no Python service and no OCR.

## Setup

```bash
pnpm install
```

Copy `apps/web/.env.example` to `apps/web/.env` and fill in a Neon connection string. Every other
variable is optional until the phase that reads it — the example file says which.

Apply the schema and start everything:

```bash
pnpm db:push
pnpm dev
```

`pnpm dev` runs the Next.js app on http://localhost:3001 and the Inngest dev server on
http://localhost:8288. Neither Inngest key is needed locally.

To watch a job move through the pipeline:

```bash
curl -X POST http://localhost:3001/api/dev/sample-job   # returns a job ID
curl http://localhost:3001/api/dev/sample-job           # the ten most recent job rows
```

Every wide event the run emits carries that job ID and the stages it covered, both on stdout and
in `apps/web/.evlog/logs/`.

## Layout

```
superfact/
├── apps/web/          # Next.js app: API routes, jobs, UI
├── packages/db/       # Drizzle schema, client, and ORM re-exports
├── packages/env/      # Validated environment contracts
├── packages/ui/       # Shared shadcn/ui primitives
├── packages/config/   # Shared tsconfig base
└── docs/              # Assignment, implementation plan, starter PDFs
```

## Scripts

| Command                                | Does                        |
| -------------------------------------- | --------------------------- |
| `pnpm dev`                             | Start Next.js and Inngest   |
| `pnpm dev:web`                         | Start only the web app      |
| `pnpm build`                           | Build all workspaces        |
| `pnpm check-types`                     | Typecheck across workspaces |
| `pnpm check`                           | Oxlint + Oxfmt              |
| `pnpm db:push`                         | Push schema to the database |
| `pnpm db:studio`                       | Open Drizzle Studio         |
| `pnpm db:generate` / `pnpm db:migrate` | Generate and run migrations |

## Adding UI components

Shared primitives live in `packages/ui`:

```bash
npx shadcn@latest add dialog table -c packages/ui
```

Import them as `@superfact/ui/components/button`. Run the shadcn CLI from `apps/web` instead when a
component is app-specific rather than shared.

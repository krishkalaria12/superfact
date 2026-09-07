# Superfact

An evidence-first fact knowledge layer for PDFs. It extracts atomic assertions, binds each one to
the exact region of the page it came from, and identifies where facts corroborate, contradict, or
only appear to contradict until you compare their context.

Built for the Superjoin engineering intern assignment (`docs/superjoin.pdf`). The implementation
plan is `docs/implementation-plan.html`.

## Status

Scaffold only. The pipeline described in the plan is not built yet.

## Stack

| Concern | Choice                                                                               |
| ------- | ------------------------------------------------------------------------------------ |
| App     | Next.js App Router, TypeScript                                                       |
| Parsing | MuPDF.js (`mupdf`, WASM). Structured text, geometry, page rasters                    |
| Models  | GPT-5.6 Luna (extraction), Terra (adjudication), Terra high (contradiction re-check) |
| Jobs    | Inngest. Stages: parse, extract, relate                                              |
| Data    | Neon PostgreSQL + pgvector, Drizzle ORM                                              |
| Files   | Vercel Blob                                                                          |
| UI      | Tailwind, shadcn/ui via `packages/ui`                                                |

Everything runs in one TypeScript process. There is no Python service and no OCR.

## Setup

```bash
pnpm install
```

Create `apps/web/.env` with a Neon connection string:

```
DATABASE_URL=postgres://...
```

Apply the schema and start the dev server:

```bash
pnpm db:push
pnpm dev
```

The web app runs on http://localhost:3001.

## Layout

```
superfact/
├── apps/web/          # Next.js app: API routes, jobs, UI
├── packages/db/       # Drizzle schema and client
├── packages/env/      # Validated environment contracts
├── packages/ui/       # Shared shadcn/ui primitives
├── packages/config/   # Shared tsconfig base
└── docs/              # Assignment, implementation plan, starter PDFs
```

## Scripts

| Command                                | Does                         |
| -------------------------------------- | ---------------------------- |
| `pnpm dev`                             | Start everything in dev mode |
| `pnpm dev:web`                         | Start only the web app       |
| `pnpm build`                           | Build all workspaces         |
| `pnpm check-types`                     | Typecheck across workspaces  |
| `pnpm check`                           | Oxlint + Oxfmt               |
| `pnpm db:push`                         | Push schema to the database  |
| `pnpm db:studio`                       | Open Drizzle Studio          |
| `pnpm db:generate` / `pnpm db:migrate` | Generate and run migrations  |

## Adding UI components

Shared primitives live in `packages/ui`:

```bash
npx shadcn@latest add dialog table -c packages/ui
```

Import them as `@superfact/ui/components/button`. Run the shadcn CLI from `apps/web` instead when a
component is app-specific rather than shared.

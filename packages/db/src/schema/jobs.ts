import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { documents } from "./documents";

/** The three durable stages a document moves through, in order. */
export const jobStage = pgEnum("job_stage", ["parse", "extract", "relate"]);

export const jobStatus = pgEnum("job_status", ["queued", "running", "completed", "failed"]);

/**
 * One processing run over one document.
 *
 * `pipelineVersion` is the same string stamped on every assertion the run publishes, so a job and
 * its output invalidate together. Re-running a document at a new version means a new job row, not
 * a mutated one.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    stage: jobStage("stage").notNull().default("parse"),
    status: jobStatus("status").notNull().default("queued"),
    pipelineVersion: text("pipeline_version").notNull(),
    failureReason: text("failure_reason"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("jobs_status_idx").on(table.status),
    index("jobs_document_id_idx").on(table.documentId),
  ],
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type JobStage = (typeof jobStage.enumValues)[number];
export type JobStatus = (typeof jobStatus.enumValues)[number];

/** Stage order. The pipeline runs these front to back. */
export const JOB_STAGES = jobStage.enumValues;

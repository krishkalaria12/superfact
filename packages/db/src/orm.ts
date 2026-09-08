/**
 * Query builders and operators, re-exported so the app never depends on `drizzle-orm` directly.
 * A second copy of the package in the tree produces two incompatible sets of column types, so
 * there is exactly one entry point: this one.
 */
export * from "drizzle-orm";

/**
 * Table aliasing, which lives in `pg-core` rather than the package root.
 *
 * Candidate pairing joins `assertions` to itself, so the alias is what lets a hand-written query
 * still take its column names from the schema instead of repeating them as strings.
 */
export { alias } from "drizzle-orm/pg-core";

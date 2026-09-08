/**
 * Query builders and operators, re-exported so the app never depends on `drizzle-orm` directly.
 * A second copy of the package in the tree produces two incompatible sets of column types, so
 * there is exactly one entry point: this one.
 */
export * from "drizzle-orm";

/**
 * The `pg-core` surface the app needs, which does not come through the package root.
 *
 * `alias` lets candidate pairing join `assertions` to itself while still taking column names from
 * the schema. `PgColumn` types the upsert helper that names a column in an `excluded.` reference,
 * so an edge upsert cannot drift from the column it means.
 */
export { alias, type PgColumn } from "drizzle-orm/pg-core";

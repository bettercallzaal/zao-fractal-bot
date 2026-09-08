// Makes a hand-written Supabase fake enforce the real schema instead of
// accepting any payload it is handed. A mock that accepts anything cannot
// catch a schema violation - that is exactly how createSession's
// `confidence: 'manual'` insert (rejected by 0002's CHECK, before 0006
// widened it) shipped with every test green. See schemaFromMigrations.ts.

import { PARTIALLY_COVERED_TABLES, type SchemaModel } from './schemaFromMigrations.js';

const PARTIALLY_COVERED_TABLE_SET: ReadonlySet<string> = new Set(PARTIALLY_COVERED_TABLES);

export type WriteMode = 'insert' | 'update';

/**
 * Throws when `payload` would violate the schema built by
 * schemaFromMigrations for `table`:
 *   - a payload key that is not a column of the table
 *   - a value that violates a CHECK constraint's allowed set
 *   - (insert only) a `not null` column with no default missing from the
 *     payload - `update` payloads are partial by nature, so this rule does
 *     not apply to them
 *
 * A table with no schema entry at all is SKIPPED silently - this function
 * cannot validate what it has no schema for, and guessing would be worse
 * than skipping. In practice every table this codebase writes to has at
 * least a column-existence schema: 8 tables from the migrations directly,
 * plus 4 more (see PARTIALLY_COVERED_TABLES in schemaFromMigrations.ts) from
 * a checked-in snapshot of the live ZAO OS project - those 4 get unknown-
 * column rejection only, not CHECK or not-null enforcement.
 *
 * `payload` may be a single row object or an array of rows (inserting many
 * rows at once, as createSession does for the roster).
 */
export function assertWritable(
  table: string,
  payload: unknown,
  schema: SchemaModel,
  mode: WriteMode = 'insert',
): void {
  const tableSchema = schema.tables.get(table);
  if (!tableSchema) return; // uncovered table - skip, don't guess

  const rows = Array.isArray(payload) ? payload : [payload];
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;

    for (const key of Object.keys(record)) {
      const column = tableSchema.columns.get(key);
      if (!column) {
        const known = [...tableSchema.columns.keys()].sort().join(', ');
        if (PARTIALLY_COVERED_TABLE_SET.has(table)) {
          // For the 9 migration-defined tables an unknown column really
          // does mean the payload is wrong - the migrations are in this
          // repo. For one of PARTIALLY_COVERED_TABLES the schema instead
          // comes from a checked-in snapshot of a database this repo does
          // not own (see zaoos-schema.json / refresh-zaoos-schema.mjs), so
          // the likelier cause is the reverse: the snapshot is stale, not
          // the payload wrong. Give this the same numbered-options
          // treatment tableCoverage.test.ts's unknown-table message gets.
          throw new Error(
            `assertWritable: table "${table}" has no column "${key}" (known columns: ${known}).\n` +
              `"${table}" is one of PARTIALLY_COVERED_TABLES - its schema comes from a checked-in ` +
              `snapshot of the live ZAO OS project (src/lib/testing/zaoos-schema.json), not from a ` +
              `migration in this repo, so the likelier explanation here is the reverse of "the ` +
              `payload is wrong":\n` +
              `  1. The column is real on the live table, but the snapshot is stale. Re-run ` +
              `\`node scripts/refresh-zaoos-schema.mjs\` against the ZAO OS project and commit the ` +
              `refreshed fixture.\n` +
              `  2. The column genuinely doesn't exist yet - add it via a migration under ` +
              `supabase/migrations/ that ALTERs this table (this repo already does that, e.g. 0005 ` +
              `adding fractal_sessions.meeting_number).\n` +
              `  3. The payload really is wrong - a typo, or a column this table never had.`,
          );
        }
        throw new Error(
          `assertWritable: table "${table}" has no column "${key}" (known columns: ${known})`,
        );
      }

      if (column.checkValues) {
        const value = record[key];
        if (value !== null && value !== undefined && !column.checkValues.has(String(value))) {
          const allowed = [...column.checkValues].sort().join(', ');
          throw new Error(
            `assertWritable: ${table}.${key} = ${JSON.stringify(value)} violates its CHECK ` +
              `constraint - allowed values: ${allowed}`,
          );
        }
      }
    }

    if (mode === 'insert') {
      for (const column of tableSchema.columns.values()) {
        // `in` is true for a key whose value is explicitly `undefined` -
        // but supabase-js drops `undefined` keys before serialising a
        // payload, so Postgres sees the column omitted entirely and
        // rejects the insert. `{ col: undefined }` must be treated exactly
        // like a missing key, not like a real value being supplied.
        const missing = !(column.name in record) || record[column.name] === undefined;
        if (column.notNull && !column.hasDefault && missing) {
          throw new Error(
            `assertWritable: insert into "${table}" is missing required column ` +
              `"${column.name}" (not null, no default)`,
          );
        }
      }
    }
  }
}

// Makes a hand-written Supabase fake enforce the real schema instead of
// accepting any payload it is handed. A mock that accepts anything cannot
// catch a schema violation - that is exactly how createSession's
// `confidence: 'manual'` insert (rejected by 0002's CHECK, before 0006
// widened it) shipped with every test green. See schemaFromMigrations.ts.

import type { SchemaModel } from './schemaFromMigrations.js';

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
 * A table the migrations do not define (see UNCOVERED_TABLES) is SKIPPED
 * silently - this function cannot validate what it has no schema for, and
 * guessing would be worse than skipping.
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
        if (column.notNull && !column.hasDefault && !(column.name in record)) {
          throw new Error(
            `assertWritable: insert into "${table}" is missing required column ` +
              `"${column.name}" (not null, no default)`,
          );
        }
      }
    }
  }
}

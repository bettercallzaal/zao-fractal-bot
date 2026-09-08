// Closes the last silent gap in the schema guard: assertWritable.ts SKIPS a
// table it has no schema entry for, without a word - a new table, a
// typo'd name, or a table nobody happened to write a test for goes
// completely unguarded, and reads exactly like covered code. That gap can't
// be caught by any test that exercises a write, because it's a gap in which
// writes get exercised at all.
//
// This test enumerates every Supabase table this codebase's source refers to
// - statically, via scanTableReferences.ts, not by relying on test coverage
// - and asserts each one is known to the guard: defined by a migration,
// present in the ZAO OS snapshot, or explicitly named in
// TABLE_COVERAGE_EXCEPTIONS with a reason. See scanTableReferences.ts for why
// this collects every `.from('table')` reference rather than trying to
// isolate writes specifically.

import { describe, expect, it } from 'vitest';
import { buildSchema } from './schemaFromMigrations.js';
import { scanTableReferences } from './scanTableReferences.js';

export interface TableCoverageException {
  table: string;
  /** Why this table is deliberately excluded from schema-guard coverage.
   * Required so an exception is a documented decision, not a quiet skip. */
  reason: string;
}

// Tables the static scan may find that are deliberately NOT expected to be
// known to the schema guard. Empty today - every table src/**/*.ts refers to
// is defined by a migration or present in the ZAO OS snapshot. Add an entry
// here only for a considered reason (e.g. a table owned by an unrelated
// project that this repo only ever reads, and will never write to); do not
// add one just to silence a failure without addressing it.
export const TABLE_COVERAGE_EXCEPTIONS: readonly TableCoverageException[] = [];

describe('every Supabase table this codebase refers to is known to the schema guard', () => {
  it('has a migration, a ZAO OS snapshot entry, or a documented exception for each table', () => {
    const { tables, filesScanned, unresolvedCount, unresolvedSamples } = scanTableReferences();
    const schema = buildSchema();
    const exceptionTables = new Set(TABLE_COVERAGE_EXCEPTIONS.map((e) => e.table));

    // A regression here means the scan itself broke (wrong rootDir, a glob
    // that stopped matching) - not that the codebase suddenly dropped to
    // zero tables. Fail loudly rather than let an empty scan pass by
    // vacuously finding nothing to complain about.
    expect(
      filesScanned,
      'scanTableReferences scanned suspiciously few files - check rootDir/exclusions',
    ).toBeGreaterThan(10);

    const unknown = [...tables].filter((t) => !schema.tables.has(t) && !exceptionTables.has(t));

    if (unknown.length > 0) {
      throw new Error(
        `tableCoverage: ${unknown.length} table(s) referenced in src/**/*.ts (excluding tests) ` +
          `are not known to the schema guard: ${unknown.sort().join(', ')}.\n` +
          `For each one, do one of:\n` +
          `  1. Add a migration under supabase/migrations/ that creates the table (or the ` +
          `columns this code needs), so schemaFromMigrations.ts can parse it.\n` +
          `  2. If it's owned by another project (like the existing ZAO OS tables), refresh ` +
          `the snapshot with \`node scripts/refresh-zaoos-schema.mjs\` so it appears in ` +
          `src/lib/testing/zaoos-schema.json.\n` +
          `  3. If this is a deliberate, permanent exception, add it to ` +
          `TABLE_COVERAGE_EXCEPTIONS in src/lib/testing/tableCoverage.test.ts with a reason.`,
      );
    }

    // Visibility, not enforcement: a `.from(...)` call this scanner could not
    // resolve to a literal table name (a computed name, a variable) is a
    // blind spot the guard cannot check either way. Hard-failing on it would
    // make this test brittle against legitimate dynamic code; reporting it
    // keeps the blind spot visible instead of invisible. Today this
    // codebase has none.
    // eslint-disable-next-line no-console
    console.info(
      `tableCoverage: ${filesScanned} files scanned, ${tables.size} table(s) checked ` +
        `(${[...tables].sort().join(', ')}), 0 unknown, ${unresolvedCount} unresolved ` +
        `.from() reference(s) I could not statically resolve` +
        (unresolvedSamples.length > 0 ? ` [${unresolvedSamples.join('; ')}]` : ''),
    );
  });

  it('starts with no exceptions - every table found today is genuinely known', () => {
    expect(TABLE_COVERAGE_EXCEPTIONS).toEqual([]);
  });
});

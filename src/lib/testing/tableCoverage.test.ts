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
// known to the schema guard. Add an entry here only for a considered reason
// (e.g. a table owned by an unrelated project that this repo only ever
// reads, and will never write to); do not add one just to silence a failure
// without addressing it.
export const TABLE_COVERAGE_EXCEPTIONS: readonly TableCoverageException[] = [
  {
    table: 'wallets',
    reason:
      'Live code queries a table that does not exist. web/lib/getWalletRegistry.ts:9 and ' +
      "web/lib/resolveMemberIdentity.ts:23,37 call .from('wallets') via " +
      'web/lib/supabaseClient.ts, which reads the same SUPABASE_URL as the bot. But MEASURED ' +
      '2026-09-01 against the ZAO OS project (efsxtoxvigqowjhgcbiz): wallets returns 404 ' +
      'PGRST205 and never existed - see src/commands/executeCommand.test.ts:233, a test that ' +
      "exists specifically to keep this repo's own bridgeIdentities action away from that same " +
      'table. This is not a schema-guard gap to close by adding a migration or a snapshot entry ' +
      '- that would make the guard silently agree that a nonexistent table is fine to write to. ' +
      'It is a live bug in web/lib that belongs in front of a human: either those two call sites ' +
      'are dead code that should be deleted, or a wallets table needs to be created for real. ' +
      'This exception documents the finding; it does not resolve it.',
  },
];

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

  it('has exactly the documented exceptions - each is a considered decision, not a quiet skip', () => {
    // Every exception here must be a real, named finding with a reason, not
    // a rubber-stamped skip - so this pins the exact set of tables and
    // requires a substantial reason for each, rather than just checking the
    // list is non-empty. Adding a table here should mean editing this
    // assertion too, keeping the decision visible in the diff.
    expect(TABLE_COVERAGE_EXCEPTIONS.map((e) => e.table)).toEqual(['wallets']);
    for (const exception of TABLE_COVERAGE_EXCEPTIONS) {
      expect(exception.reason.length).toBeGreaterThan(20);
    }
  });
});

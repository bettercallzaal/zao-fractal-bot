// A chainable Supabase fake, shared by every test that needs to record writes
// and have them checked against the real schema. Originally lived inline in
// gameRepo.test.ts; lifted out here so executeCommand.test.ts and the
// awareness tests (heartbeat, voiceTracker) can reuse the exact same guarded
// fake instead of each hand-rolling (and potentially under-guarding) their
// own. See assertWritable.ts and schemaFromMigrations.ts for what "guarded"
// means and why it exists.
//
// Importing this fake instead of hand-rolling a `{ from: () => ({ insert: ...
// }) }` stub is load-bearing, not a style preference: a hand-rolled fake is
// silently unguarded (it accepts any payload, exactly the bug this whole
// effort exists to catch), and tableCoverage.test.ts cannot catch that for
// you - it checks that tables are known to the schema guard, not that a
// given test file's fake actually calls the guard. See
// web/lib/dispatchCommand.test.ts for a real, unfixed example of this exact
// gap: it hand-rolls its own ungated fake that inserts into `bot_commands`.

import { assertWritable } from './assertWritable.js';
import { buildSchema, type SchemaModel } from './schemaFromMigrations.js';

export interface Call {
  table: string;
  op: string;
  payload?: unknown;
}

export type FakeResult = { data?: unknown; error?: { message: string } | null };

// Built once from the real migrations so every write recorded by this fake is
// checked against the schema those migrations actually create - not just
// accepted because the fake has no opinion. This is what would have caught
// createSession's `confidence: 'manual'` insert before 0006 widened the
// CHECK: see src/lib/testing/assertWritable.test.ts for the guard's own
// tests.
const schema: SchemaModel = buildSchema();

/** A chainable Supabase fake. Records every (table, op) and resolves each to a
 * configured result, so a test can make one specific write fail.
 *
 * It cannot tell you a table is missing - no mock can, which is the lesson
 * from PR #15 - so the table names here are the ones checked against the live
 * database by hand in migration 0005.
 *
 * Every insert/upsert/update is run through assertWritable first, so a
 * payload that uses an unknown column, violates a CHECK, or omits a
 * not-null-no-default column throws here instead of silently "succeeding"
 * the way an unguarded mock would.
 */
export function fakeSupabase(opts: {
  results?: Record<string, FakeResult>;
  failOn?: { table: string; op: string };
} = {}) {
  const calls: Call[] = [];

  function builder(table: string, op: string): Record<string, unknown> {
    const key = `${table}.${op}`;
    const failed = opts.failOn && opts.failOn.table === table && opts.failOn.op === op;
    const result: FakeResult = failed
      ? { data: null, error: { message: `simulated ${op} failure on ${table}` } }
      : (opts.results?.[key] ?? { data: [], error: null });

    const self: Record<string, unknown> = {
      select: () => self,
      eq: () => self,
      in: () => self,
      is: () => self,
      order: () => self,
      single: async () => result,
      maybeSingle: async () => result,
      then: (resolve: (v: FakeResult) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return self;
  }

  return {
    calls,
    from(table: string) {
      return {
        insert: (payload: unknown) => {
          // update payloads are partial by nature (a resolveRound only sets
          // winner_discord_id + resolved_at), so the not-null-presence rule
          // applies to insert and upsert only - both write a full row.
          assertWritable(table, payload, schema, 'insert');
          calls.push({ table, op: 'insert', payload });
          return builder(table, 'insert');
        },
        upsert: (payload: unknown) => {
          assertWritable(table, payload, schema, 'insert');
          calls.push({ table, op: 'upsert', payload });
          return builder(table, 'upsert');
        },
        update: (payload: unknown) => {
          assertWritable(table, payload, schema, 'update');
          calls.push({ table, op: 'update', payload });
          return builder(table, 'update');
        },
        select: (cols?: string) => {
          calls.push({ table, op: 'select', payload: cols });
          return builder(table, 'select');
        },
      };
    },
  };
}

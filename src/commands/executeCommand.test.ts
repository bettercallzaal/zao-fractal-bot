import { describe, expect, it } from 'vitest';
import { executeCommand } from './executeCommand.js';
import { assertWritable } from '../lib/testing/assertWritable.js';
import { buildSchema } from '../lib/testing/schemaFromMigrations.js';

// Built once from the real migrations so every write these fakes record is
// checked against the schema those migrations actually create, the same way
// gameRepo.test.ts's fakeSupabase does. See src/lib/testing/fakeSupabase.ts.
const schema = buildSchema();

interface MockScenario {
  existingRows: Record<string, any>[];
  updateToFinalStatusShouldFail?: boolean;
}

function makeFakeSupabase(scenario: MockScenario) {
  const rows = scenario.existingRows;

  return {
    from: (table: string) => ({
      update: (values: Record<string, any>) => {
        // Every update executeCommand issues here is a partial payload
        // (claiming or finalizing a bot_commands row), so 'update' mode is
        // correct - it does not require every not-null-no-default column.
        assertWritable(table, values, schema, 'update');
        const isClaimUpdate = values.status === 'processing';

        if (isClaimUpdate) {
          // Claim update: update status to 'processing' where idempotency_key=X and status='pending'
          return {
            eq: (keyName: string, keyValue: string) => ({
              eq: (statusKeyName: string, statusValue: string) => ({
                select: () => ({
                  single: async () => {
                    const row = rows.find(
                      (r) => r.idempotency_key === keyValue && r.status === 'pending'
                    );
                    if (!row) {
                      return { data: null, error: { code: 'PGRST116' } };
                    }
                    row.status = 'processing';
                    return { data: row, error: null };
                  },
                }),
              }),
            }),
          };
        } else {
          // Final update: update status to 'done' or 'failed'
          // Return object with .eq() method that returns an awaitable
          const self = {
            eq: () => {
              // Return a thenable/awaitable object
              return Promise.resolve(
                scenario.updateToFinalStatusShouldFail
                  ? { error: { message: 'Simulated update failure' } }
                  : { error: null }
              );
            },
          };
          return self;
        }
      },

      select: () => ({
        eq: (keyName: string, keyValue: string) => ({
          maybeSingle: async () => {
            const row = rows.find((r) => r.idempotency_key === keyValue);
            return { data: row || null, error: null };
          },
        }),
      }),
    }),
  };
}

describe('executeCommand with UPDATE-based claiming', () => {
  it('(a) successfully claims pending row, runs action, and marks row done', async () => {
    const existingRows = [
      { id: 'row-1', idempotency_key: 'idem-a', status: 'pending', action: 'randomize', params: {} },
    ];
    const supabase = makeFakeSupabase({ existingRows });

    const result = await executeCommand(
      supabase as any,
      'randomize',
      { memberIds: ['a', 'b', 'c'], maxGroupSize: 6 },
      'idem-a',
      'admin-discord-id'
    );

    expect(result.status).toBe('done');
    expect(result.result).toBeDefined();
    expect(result.result).toHaveProperty('groups');
  });

  it('(b) returns already_processed without re-running when row is already processing (race lost)', async () => {
    const existingRows = [
      { id: 'row-1', idempotency_key: 'idem-b', status: 'processing' },
    ];
    const supabase = makeFakeSupabase({ existingRows });

    const result = await executeCommand(
      supabase as any,
      'randomize',
      { memberIds: ['a', 'b'], maxGroupSize: 6 },
      'idem-b',
      'admin-discord-id'
    );

    expect(result.status).toBe('already_processed');
  });

  it('(c) returns already_processed with existing result when row is already done', async () => {
    const existingRows = [
      {
        id: 'row-1',
        idempotency_key: 'idem-c',
        status: 'done',
        result: { groups: [['a', 'b']] },
      },
    ];
    const supabase = makeFakeSupabase({ existingRows });

    const result = await executeCommand(
      supabase as any,
      'randomize',
      { memberIds: ['a', 'b'], maxGroupSize: 6 },
      'idem-c',
      'admin-discord-id'
    );

    expect(result.status).toBe('already_processed');
    expect(result.result).toEqual({ groups: [['a', 'b']] });
  });

  it('(d) throws clear error when no row exists at all for the idempotency_key', async () => {
    const supabase = makeFakeSupabase({ existingRows: [] });

    await expect(
      executeCommand(
        supabase as any,
        'randomize',
        { memberIds: ['a'], maxGroupSize: 6 },
        'idem-does-not-exist',
        'admin-discord-id'
      )
    ).rejects.toThrow('No pending command found for idempotency_key: idem-does-not-exist');
  });

  it('(e) rejects unknown action before attempting to claim', async () => {
    const existingRows = [
      { id: 'row-1', idempotency_key: 'idem-e', status: 'pending' },
    ];
    const supabase = makeFakeSupabase({ existingRows });

    await expect(
      executeCommand(supabase as any, 'nonexistent_action', {}, 'idem-e', 'admin-discord-id')
    ).rejects.toThrow('Unknown action: nonexistent_action');
  });

  it('(f) catches action execution failure and records it as failed', async () => {
    const existingRows = [
      { id: 'row-1', idempotency_key: 'idem-f', status: 'pending' },
    ];
    const supabase = makeFakeSupabase({ existingRows });

    // Pass invalid memberIds to cause action to throw
    const result = await executeCommand(
      supabase as any,
      'randomize',
      { memberIds: { invalid: 'not-an-array' }, maxGroupSize: 6 },
      'idem-f',
      'admin-discord-id'
    );

    expect(result.status).toBe('failed');
  });

  it('(g) throws error if final update fails after successful execution', async () => {
    const existingRows = [
      { id: 'row-1', idempotency_key: 'idem-g', status: 'pending' },
    ];
    const supabase = makeFakeSupabase({ existingRows, updateToFinalStatusShouldFail: true });

    await expect(
      executeCommand(
        supabase as any,
        'randomize',
        { memberIds: ['a', 'b'], maxGroupSize: 6 },
        'idem-g',
        'admin-discord-id'
      )
    ).rejects.toThrow('Failed to update row after successful execution');
  });
});

/** Records every table an action reads, and serves the claim/complete flow so
 * the action under test actually runs. This fake cannot tell you a relation
 * is missing - no mock can, which is exactly why a query against a table
 * that does not exist passed CI for months - so instead of pretending to
 * check existence, it pins the set of tables an action reads, and that set is
 * checked against the live database by hand. Its bot_commands updates are
 * still run through assertWritable, same as makeFakeSupabase above. */
function makeTableRecordingSupabase(idempotencyKey: string, tablesRead: string[]) {
  const row: Record<string, any> = { id: 'row-1', idempotency_key: idempotencyKey, status: 'pending' };
  return {
    from: (table: string) => ({
      update: (values: Record<string, any>) => {
        assertWritable(table, values, schema, 'update');
        return values.status === 'processing'
          ? {
              eq: () => ({
                eq: () => ({
                  select: () => ({ single: async () => ({ data: row, error: null }) }),
                }),
              }),
            }
          : { eq: () => Promise.resolve({ error: null }) };
      },
      select: (_cols?: string) => {
        // A bare `.select()` that is awaited directly is a table read by an action.
        // The claim path never reaches here; it goes through `update`.
        if (table !== 'bot_commands') tablesRead.push(table);
        return Promise.resolve({ data: [], error: null });
      },
    }),
  };
}

describe('bridgeIdentities reads only tables that exist', () => {
  /** MEASURED 2026-09-01 against the ZAO OS project (efsxtoxvigqowjhgcbiz):
   * respect_members and users exist; `wallets` returns 404 PGRST205 and never
   * existed. This action used to read all three, so it threw on first run
   * while its mocked tests stayed green. See
   * docs/superpowers/specs/2026-09-01-respect-game-core-design.md section 5.1. */
  it('does not query the wallets table, which does not exist', async () => {
    const tablesRead: string[] = [];
    const supabase = makeTableRecordingSupabase('idem-bridge', tablesRead);

    await executeCommand(supabase as any, 'bridgeIdentities', {}, 'idem-bridge', 'admin');

    expect(tablesRead).not.toContain('wallets');
    expect(new Set(tablesRead)).toEqual(new Set(['respect_members', 'users']));
  });
});

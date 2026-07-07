import { describe, expect, it, vi } from 'vitest';
import { executeCommand } from './executeCommand.js';

function makeFakeSupabase(existingRow: Record<string, unknown> | null, updateErrorOnCall?: number) {
  const updateCalls: Record<string, unknown>[] = [];
  let updateCallCount = 0;
  return {
    updateCalls,
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => {
            if (existingRow) {
              return { data: null, error: { code: '23505' } }; // unique_violation
            }
            return { data: { id: 'row-1', status: 'processing' }, error: null };
          },
        }),
      }),
      select: () => ({
        eq: () => ({
          single: async () => ({ data: existingRow, error: null }),
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: () => {
          updateCalls.push(values);
          const currentCall = updateCallCount++;
          // Simulate an update error on a specific call if configured
          const shouldError = updateErrorOnCall !== undefined && currentCall === updateErrorOnCall;
          return Promise.resolve(shouldError ? { error: { message: 'Update failed' } } : { error: null });
        },
      }),
    }),
  };
}

describe('executeCommand', () => {
  it('runs the action and marks the row done on first execution', async () => {
    const supabase = makeFakeSupabase(null);
    const result = await executeCommand(
      supabase as any,
      'randomize',
      { memberIds: ['a', 'b', 'c'], maxGroupSize: 6 },
      'idem-key-1',
      'admin-discord-id',
    );
    expect(result.status).toBe('done');
    expect(supabase.updateCalls[0]).toMatchObject({ status: 'done' });
  });

  it('returns already_processed without re-running when the row is already done', async () => {
    const supabase = makeFakeSupabase({ id: 'row-1', status: 'done', result: { groups: [['a']] } });
    const result = await executeCommand(
      supabase as any,
      'randomize',
      { memberIds: ['a'], maxGroupSize: 6 },
      'idem-key-1',
      'admin-discord-id',
    );
    expect(result.status).toBe('already_processed');
    expect(supabase.updateCalls.length).toBe(0);
  });

  it('rejects an unknown action', async () => {
    const supabase = makeFakeSupabase(null);
    await expect(
      executeCommand(supabase as any, 'nonexistent_action', {}, 'idem-key-2', 'admin-discord-id'),
    ).rejects.toThrow('Unknown action: nonexistent_action');
  });

  it('catches action execution failure and records it as failed', async () => {
    const supabase = makeFakeSupabase(null);
    // Pass invalid memberIds (not an array) to cause distributeIntoGroups to throw
    const result = await executeCommand(
      supabase as any,
      'randomize',
      { memberIds: { invalid: 'object' }, maxGroupSize: 6 }, // Not an array - will cause iteration error
      'idem-key-3',
      'admin-discord-id',
    );
    expect(result.status).toBe('failed');
    expect(result.result).toBeUndefined();
    // Verify the failure was recorded in the database
    expect(supabase.updateCalls[0]).toMatchObject({ status: 'failed' });
    expect(supabase.updateCalls[0].result).toHaveProperty('error');
  });

  it('throws error if update fails after successful execution', async () => {
    const supabase = makeFakeSupabase(null, 0); // Fail on first update call
    await expect(
      executeCommand(
        supabase as any,
        'randomize',
        { memberIds: ['a', 'b', 'c'], maxGroupSize: 6 },
        'idem-key-4',
        'admin-discord-id',
      ),
    ).rejects.toThrow('Failed to update row after successful execution');
  });

  it('throws error if update fails after execution failure', async () => {
    const supabase = makeFakeSupabase(null, 0); // Fail on first update call
    // Also need to fail on the second update call (the failure-path update)
    let updateCallIndex = 0;
    const supabaseWithDoubleFailure = {
      ...supabase,
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: { id: 'row-1', status: 'processing' }, error: null }),
          }),
        }),
        select: () => ({
          eq: () => ({
            single: async () => ({ data: null, error: null }),
          }),
        }),
        update: (values: Record<string, unknown>) => ({
          eq: () => {
            supabase.updateCalls.push(values);
            // Always fail updates in this test
            return Promise.resolve({ error: { message: 'Update failed' } });
          },
        }),
      }),
    };
    await expect(
      executeCommand(
        supabaseWithDoubleFailure as any,
        'randomize',
        { memberIds: { invalid: 'object' }, maxGroupSize: 6 }, // Will throw during execution
        'idem-key-5',
        'admin-discord-id',
      ),
    ).rejects.toThrow('Failed to update row after execution failure');
  });
});

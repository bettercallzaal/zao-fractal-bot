import { describe, expect, it } from 'vitest';
import { getRecentCommands } from './getRecentCommands.js';

interface FakeSupabaseResult {
  client: any;
  calls: {
    order: { column: string; options: any } | null;
    limit: number | null;
  };
}

function makeFakeSupabase(rows: Record<string, unknown>[]): FakeSupabaseResult {
  const calls = {
    order: null as { column: string; options: any } | null,
    limit: null as number | null,
  };

  const client = {
    from: () => ({
      select: () => ({
        order: (column: string, options: any) => {
          calls.order = { column, options };
          return {
            limit: async (n: number) => {
              calls.limit = n;
              return { data: rows, error: null };
            },
          };
        },
      }),
    }),
  };

  return { client, calls };
}

describe('getRecentCommands', () => {
  it('maps rows into the expected shape', async () => {
    const { client, calls } = makeFakeSupabase([
      { id: 'row-1', action: 'randomize', status: 'done', requested_by: 'admin-1', created_at: '2026-07-07T00:00:00Z' },
    ]);
    const commands = await getRecentCommands(client as any);
    expect(commands).toEqual([
      { id: 'row-1', action: 'randomize', status: 'done', requestedBy: 'admin-1', createdAt: '2026-07-07T00:00:00Z' },
    ]);
    expect(calls.order).toEqual({ column: 'created_at', options: { ascending: false } });
    expect(calls.limit).toBe(20);
  });

  it('returns an empty array when there are no commands yet', async () => {
    const { client, calls } = makeFakeSupabase([]);
    expect(await getRecentCommands(client as any)).toEqual([]);
    expect(calls.order).toEqual({ column: 'created_at', options: { ascending: false } });
    expect(calls.limit).toBe(20);
  });

  it('uses custom limit when provided', async () => {
    const { client, calls } = makeFakeSupabase([
      { id: 'row-1', action: 'randomize', status: 'done', requested_by: 'admin-1', created_at: '2026-07-07T00:00:00Z' },
    ]);
    await getRecentCommands(client as any, 5);
    expect(calls.order).toEqual({ column: 'created_at', options: { ascending: false } });
    expect(calls.limit).toBe(5);
  });
});

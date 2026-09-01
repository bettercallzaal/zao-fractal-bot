import { describe, expect, it } from 'vitest';
import { completeSession, createSession, loadSessionByThread, recordVote } from './gameRepo.js';
import { startSession } from '../game/session.js';

interface Call {
  table: string;
  op: string;
  payload?: unknown;
}

type Result = { data?: unknown; error?: { message: string } | null };

/** A chainable Supabase fake. Records every (table, op) and resolves each to a
 * configured result, so a test can make one specific write fail.
 *
 * It cannot tell you a table is missing - no mock can, which is the lesson
 * from PR #15 - so the table names here are the ones checked against the live
 * database by hand in migration 0005. */
function fakeSupabase(opts: {
  results?: Record<string, Result>;
  failOn?: { table: string; op: string };
} = {}) {
  const calls: Call[] = [];

  function builder(table: string, op: string): Record<string, unknown> {
    const key = `${table}.${op}`;
    const failed = opts.failOn && opts.failOn.table === table && opts.failOn.op === op;
    const result: Result = failed
      ? { data: null, error: { message: `simulated ${op} failure on ${table}` } }
      : (opts.results?.[key] ?? { data: [], error: null });

    const self: Record<string, unknown> = {
      select: () => self,
      eq: () => self,
      in: () => self,
      order: () => self,
      single: async () => result,
      maybeSingle: async () => result,
      then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return self;
  }

  return {
    calls,
    from(table: string) {
      return {
        insert: (payload: unknown) => {
          calls.push({ table, op: 'insert', payload });
          return builder(table, 'insert');
        },
        upsert: (payload: unknown) => {
          calls.push({ table, op: 'upsert', payload });
          return builder(table, 'upsert');
        },
        update: (payload: unknown) => {
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

const state = startSession({
  threadId: 'thread-1',
  meetingNumber: 111,
  groupNumber: '1',
  participants: [
    { discordId: 'u1', displayName: 'One', wallet: '0x1' },
    { discordId: 'u2', displayName: 'Two', wallet: null },
  ],
});

const sessionInsertOk = { 'fractal_sessions.insert': { data: { id: 'sess-1' }, error: null } };

describe('createSession', () => {
  it('writes an active session row carrying the meeting number', async () => {
    const sb = fakeSupabase({ results: sessionInsertOk });
    const stored = await createSession(sb as never, {
      state,
      name: 'ZAO Fractal 111 - Group 1',
      guildId: 'g1',
      facilitatorDiscordId: 'u1',
    });
    expect(stored.sessionId).toBe('sess-1');
    const row = sb.calls.find((c) => c.table === 'fractal_sessions')?.payload as Record<
      string,
      unknown
    >;
    expect(row.status).toBe('active');
    expect(row.meeting_number).toBe(111);
    expect(row.thread_id).toBe('thread-1');
  });

  it('persists the roster, or resume would come back with an empty group', async () => {
    const sb = fakeSupabase({ results: sessionInsertOk });
    await createSession(sb as never, {
      state,
      name: 'n',
      guildId: 'g1',
      facilitatorDiscordId: 'u1',
    });
    const roster = sb.calls.find((c) => c.table === 'discord_roster')?.payload as Record<
      string,
      unknown
    >[];
    expect(roster).toHaveLength(2);
    expect(roster[0].session_id).toBe('sess-1');
    expect(roster[0].discord_id).toBe('u1');
  });

  it('rejects rather than resolving when the write fails', async () => {
    const sb = fakeSupabase({ failOn: { table: 'fractal_sessions', op: 'insert' } });
    await expect(
      createSession(sb as never, {
        state,
        name: 'n',
        guildId: 'g1',
        facilitatorDiscordId: 'u1',
      }),
    ).rejects.toThrow(/simulated/);
  });
});

describe('recordVote', () => {
  it('upserts so a changed vote replaces rather than duplicates', async () => {
    const sb = fakeSupabase({
      results: { 'discord_fractal_rounds.select': { data: { id: 'round-1' }, error: null } },
    });
    await recordVote(sb as never, {
      sessionId: 'sess-1',
      level: 6,
      votesNeeded: 2,
      voterDiscordId: 'u1',
      candidateDiscordId: 'u2',
    });
    const voteCall = sb.calls.find((c) => c.table === 'discord_fractal_votes');
    expect(voteCall?.op).toBe('upsert');
    expect((voteCall?.payload as Record<string, unknown>).round_id).toBe('round-1');
  });

  it('rejects when the vote write fails - a failed write must fail the round', async () => {
    const sb = fakeSupabase({
      results: { 'discord_fractal_rounds.select': { data: { id: 'round-1' }, error: null } },
      failOn: { table: 'discord_fractal_votes', op: 'upsert' },
    });
    await expect(
      recordVote(sb as never, {
        sessionId: 'sess-1',
        level: 6,
        votesNeeded: 2,
        voterDiscordId: 'u1',
        candidateDiscordId: 'u2',
      }),
    ).rejects.toThrow(/simulated/);
  });
});

describe('completeSession', () => {
  it('writes scores and flips the session to completed', async () => {
    const sb = fakeSupabase();
    await completeSession(sb as never, {
      sessionId: 'sess-1',
      ranking: [
        {
          discordId: 'u1',
          displayName: 'One',
          wallet: '0x1',
          level: 6,
          rank: 1,
          respectPoints: 110,
        },
        { discordId: 'u2', displayName: 'Two', wallet: null, level: 5, rank: 2, respectPoints: 68 },
      ],
    });
    const scores = sb.calls.find((c) => c.table === 'fractal_scores')?.payload as Record<
      string,
      unknown
    >[];
    expect(scores).toHaveLength(2);
    expect(scores[0].respect_points).toBe(110);
    expect(scores[0].session_id).toBe('sess-1');
    const update = sb.calls.find((c) => c.table === 'fractal_sessions' && c.op === 'update')
      ?.payload as Record<string, unknown>;
    expect(update.status).toBe('completed');
  });
});

describe('loadSessionByThread', () => {
  it('returns null when the thread has no session', async () => {
    const sb = fakeSupabase({ results: { 'fractal_sessions.select': { data: null, error: null } } });
    expect(await loadSessionByThread(sb as never, 'nope')).toBeNull();
  });

  it('rehydrates participants, winners and the open round votes', async () => {
    // A restart mid-fractal must not cost the group the round. Zaal moved this
    // into Phase 1 on 2026-09-01.
    const sb = fakeSupabase({
      results: {
        'fractal_sessions.select': {
          data: {
            id: 'sess-1',
            meeting_number: 111,
            group_number: '1',
            thread_id: 'thread-1',
            status: 'active',
          },
          error: null,
        },
        'discord_roster.select': {
          data: [
            { discord_id: 'u1', display_name: 'One', wallet_address: '0x1' },
            { discord_id: 'u2', display_name: 'Two', wallet_address: null },
            { discord_id: 'u3', display_name: 'Three', wallet_address: '0x3' },
          ],
          error: null,
        },
        'discord_fractal_rounds.select': {
          data: [
            { id: 'r6', level: 6, winner_discord_id: 'u2', resolved_at: '2026-09-01T00:00:00Z' },
            { id: 'r5', level: 5, winner_discord_id: null, resolved_at: null },
          ],
          error: null,
        },
        'discord_fractal_votes.select': {
          data: [{ voter_discord_id: 'u1', candidate_discord_id: 'u3' }],
          error: null,
        },
      },
    });

    const restored = await loadSessionByThread(sb as never, 'thread-1');
    expect(restored?.sessionId).toBe('sess-1');
    expect(restored?.state.participants.map((p) => p.discordId)).toEqual(['u1', 'u2', 'u3']);
    expect(restored?.state.winners).toEqual([{ level: 6, discordId: 'u2' }]);
    expect(restored?.state.currentLevel).toBe(5);
    expect(restored?.state.votes).toEqual({ u1: 'u3' });
    expect(restored?.state.meetingNumber).toBe(111);
  });
});

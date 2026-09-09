import { describe, expect, it } from 'vitest';
import { startHeartbeat } from './heartbeat.js';
import { fakeSupabase } from '../lib/testing/fakeSupabase.js';

// heartbeat.ts had no test file at all before this - its write payload had
// never been executed by any test, so the schema guard could not see it. This
// is not full behavioural coverage of startHeartbeat (the polling interval,
// shutdown, etc.) - just enough to drive its one write through a guarded
// fake, per the schema-guard-coverage task.

function fakeClient(guildCount: number) {
  return { guilds: { cache: { size: guildCount } } } as unknown as Parameters<
    typeof startHeartbeat
  >[0];
}

describe('startHeartbeat', () => {
  it('upserts a heartbeat row the real schema accepts', async () => {
    const sb = fakeSupabase();
    const client = fakeClient(3);

    // intervalMs is large so only the immediate fire-on-start write runs.
    const timer = startHeartbeat(client, sb as never, 60_000);
    try {
      // startHeartbeat's first write is fire-and-forget (`void write()`); let
      // its microtasks (including the assertWritable check inside the fake's
      // upsert) settle before asserting on what it recorded.
      await new Promise((resolve) => setTimeout(resolve, 0));

      const call = sb.calls.find((c) => c.table === 'discord_bot_heartbeats');
      expect(call?.op).toBe('upsert');
      const row = call?.payload as Record<string, unknown>;
      expect(row.bot_name).toBe('fractalbot');
      expect(row.status).toBe('up');
      expect(row.guild_count).toBe(3);
      expect(typeof row.last_seen).toBe('string');
    } finally {
      clearInterval(timer);
    }
  });
});

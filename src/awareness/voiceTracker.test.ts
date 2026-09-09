import { describe, expect, it } from 'vitest';
import { Events } from 'discord.js';
import { startVoiceTracker } from './voiceTracker.js';
import { fakeSupabase } from '../lib/testing/fakeSupabase.js';

// voiceTracker.ts had no test file at all before this - its write payloads
// (discord_bot_events inserts, discord_voice_presence inserts and updates)
// had never been executed by any test, so the schema guard could not see
// them. This is not full behavioural coverage of the module (that lives in
// lib/voicePresence.test.ts for the pure classification logic) - just enough
// to drive every insert/update it performs through a guarded fake at least
// once, per the schema-guard-coverage task.

type Handler = (oldState: unknown, newState: unknown) => Promise<void>;

/** The structural slice of discord.js's Client that startVoiceTracker uses:
 * `.on(Events.VoiceStateUpdate, handler)`. Captures the handler so the test
 * can fire synthetic voiceStateUpdate transitions by hand. */
function fakeClient() {
  let handler: Handler | undefined;
  const client = {
    on: (event: string, cb: Handler) => {
      if (event === Events.VoiceStateUpdate) handler = cb;
      return client;
    },
  };
  return {
    client: client as unknown as Parameters<typeof startVoiceTracker>[0],
    fire: async (oldState: unknown, newState: unknown) => {
      if (!handler) throw new Error('voiceStateUpdate handler was never registered');
      await handler(oldState, newState);
    },
  };
}

const member = { id: 'u1', displayName: 'One' };
const guild = { id: 'g1' };

function voiceState(channelId: string | null, selfVideo = false, streaming = false) {
  return { channelId, selfVideo, streaming, member, guild };
}

describe('startVoiceTracker', () => {
  it('records a join as an event-log insert and an open presence insert the schema accepts', async () => {
    const sb = fakeSupabase();
    const { client, fire } = fakeClient();
    startVoiceTracker(client, sb as never, ['vc1']);

    await fire(voiceState(null), voiceState('vc1'));

    const eventInsert = sb.calls.find((c) => c.table === 'discord_bot_events' && c.op === 'insert');
    expect(eventInsert).toBeDefined();
    const events = eventInsert?.payload as Record<string, unknown>[];
    expect(events[0].event_type).toBe('voice_joined');
    expect(events[0].discord_id).toBe('u1');

    const presenceInsert = sb.calls.find(
      (c) => c.table === 'discord_voice_presence' && c.op === 'insert',
    );
    expect(presenceInsert).toBeDefined();
    const row = presenceInsert?.payload as Record<string, unknown>;
    expect(row.discord_id).toBe('u1');
    expect(row.channel_id).toBe('vc1');
  });

  it('records a camera toggle while present as a presence update the schema accepts', async () => {
    const sb = fakeSupabase();
    const { client, fire } = fakeClient();
    startVoiceTracker(client, sb as never, ['vc1']);

    await fire(voiceState(null), voiceState('vc1'));
    await fire(voiceState('vc1', false), voiceState('vc1', true));

    const cameraUpdate = sb.calls.find(
      (c) => c.table === 'discord_voice_presence' && c.op === 'update',
    );
    expect(cameraUpdate).toBeDefined();
    expect((cameraUpdate?.payload as Record<string, unknown>).camera_on).toBe(true);
  });

  it('records leaving as a presence-close update the schema accepts', async () => {
    const sb = fakeSupabase();
    const { client, fire } = fakeClient();
    startVoiceTracker(client, sb as never, ['vc1']);

    await fire(voiceState(null), voiceState('vc1'));
    await fire(voiceState('vc1'), voiceState(null));

    const closeUpdate = sb.calls.find(
      (c) => c.table === 'discord_voice_presence' && c.op === 'update',
    );
    expect(closeUpdate).toBeDefined();
    expect(typeof (closeUpdate?.payload as Record<string, unknown>).left_at).toBe('string');
  });
});

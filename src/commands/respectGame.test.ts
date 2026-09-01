import { describe, expect, it, vi } from 'vitest';
import { castFractalVote, startFractal } from './respectGame.js';
import { startSession } from '../game/session.js';
import * as repo from '../lib/gameRepo.js';

const participants = [
  { discordId: 'u1', displayName: 'One', wallet: '0x1' },
  { discordId: 'u2', displayName: 'Two', wallet: '0x2' },
  { discordId: 'u3', displayName: 'Three', wallet: null },
];

const freshState = () =>
  startSession({ threadId: 't', meetingNumber: 111, groupNumber: '1', participants });

describe('startFractal', () => {
  it('persists before returning, so a caller never has state the database lacks', async () => {
    const spy = vi
      .spyOn(repo, 'createSession')
      .mockResolvedValue({ sessionId: 'sess-1', state: freshState() });
    const out = await startFractal(
      {
        threadId: 't',
        guildId: 'g',
        facilitatorDiscordId: 'u1',
        name: 'ZAO Fractal 111 - Group 1',
        meetingNumber: 111,
        groupNumber: '1',
        participants,
      },
      { supabase: {} as never },
    );
    expect(spy).toHaveBeenCalledOnce();
    expect(out.sessionId).toBe('sess-1');
    // Strict majority of 3 is 2.
    expect(out.votesNeeded).toBe(2);
    spy.mockRestore();
  });

  it('propagates a persistence failure instead of returning a session', async () => {
    const spy = vi.spyOn(repo, 'createSession').mockRejectedValue(new Error('db down'));
    await expect(
      startFractal(
        {
          threadId: 't',
          guildId: 'g',
          facilitatorDiscordId: 'u1',
          name: 'n',
          meetingNumber: 111,
          groupNumber: '1',
          participants,
        },
        { supabase: {} as never },
      ),
    ).rejects.toThrow('db down');
    spy.mockRestore();
  });
});

describe('castFractalVote', () => {
  it('does not persist a vote the engine rejected', async () => {
    const spy = vi.spyOn(repo, 'recordVote').mockResolvedValue(undefined);
    const out = await castFractalVote(
      {
        sessionId: 'sess-1',
        state: freshState(),
        voterDiscordId: 'stranger',
        candidateDiscordId: 'u2',
      },
      { supabase: {} as never },
    );
    expect(out.accepted).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not resolve a round until the whole group has voted', async () => {
    vi.spyOn(repo, 'recordVote').mockResolvedValue(undefined);
    const resolve = vi.spyOn(repo, 'resolveRound').mockResolvedValue(undefined);
    let out = await castFractalVote(
      { sessionId: 'sess-1', state: freshState(), voterDiscordId: 'u1', candidateDiscordId: 'u2' },
      { supabase: {} as never },
    );
    out = await castFractalVote(
      { sessionId: 'sess-1', state: out.state, voterDiscordId: 'u2', candidateDiscordId: 'u2' },
      { supabase: {} as never },
    );
    // Two of three is already a strict majority, but u3 has not voted.
    expect(out.roundWinnerId).toBeNull();
    expect(out.awaitingVoters).toEqual(['u3']);
    expect(resolve).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('completes the session and returns the ranking on the final vote', async () => {
    vi.spyOn(repo, 'recordVote').mockResolvedValue(undefined);
    vi.spyOn(repo, 'resolveRound').mockResolvedValue(undefined);
    const complete = vi.spyOn(repo, 'completeSession').mockResolvedValue(undefined);

    let out = await castFractalVote(
      { sessionId: 'sess-1', state: freshState(), voterDiscordId: 'u1', candidateDiscordId: 'u2' },
      { supabase: {} as never },
    );
    out = await castFractalVote(
      { sessionId: 'sess-1', state: out.state, voterDiscordId: 'u2', candidateDiscordId: 'u2' },
      { supabase: {} as never },
    );
    out = await castFractalVote(
      { sessionId: 'sess-1', state: out.state, voterDiscordId: 'u3', candidateDiscordId: 'u2' },
      { supabase: {} as never },
    );
    expect(out.roundWinnerId).toBe('u2');

    out = await castFractalVote(
      { sessionId: 'sess-1', state: out.state, voterDiscordId: 'u1', candidateDiscordId: 'u3' },
      { supabase: {} as never },
    );
    out = await castFractalVote(
      { sessionId: 'sess-1', state: out.state, voterDiscordId: 'u2', candidateDiscordId: 'u3' },
      { supabase: {} as never },
    );
    out = await castFractalVote(
      { sessionId: 'sess-1', state: out.state, voterDiscordId: 'u3', candidateDiscordId: 'u3' },
      { supabase: {} as never },
    );

    expect(out.sessionComplete).toBe(true);
    expect(complete).toHaveBeenCalledOnce();
    expect(out.ranking?.map((r) => r.respectPoints)).toEqual([110, 68, 42]);
    vi.restoreAllMocks();
  });

  it('rejects when the vote write fails, so the round does not advance silently', async () => {
    const spy = vi.spyOn(repo, 'recordVote').mockRejectedValue(new Error('write failed'));
    await expect(
      castFractalVote(
        { sessionId: 'sess-1', state: freshState(), voterDiscordId: 'u1', candidateDiscordId: 'u2' },
        { supabase: {} as never },
      ),
    ).rejects.toThrow('write failed');
    spy.mockRestore();
  });
});

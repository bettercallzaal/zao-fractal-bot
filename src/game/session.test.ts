import { describe, expect, it } from 'vitest';
import {
  activeCandidates,
  castVote,
  finalRanking,
  type GameState,
  type Participant,
  startSession,
  votesNeeded,
} from './session.js';

function people(n: number): Participant[] {
  return Array.from({ length: n }, (_, i) => ({
    discordId: `u${i + 1}`,
    displayName: `User ${i + 1}`,
    wallet: `0x${String(i + 1).repeat(40)}`,
  }));
}

function newGame(n = 4): GameState {
  return startSession({
    threadId: 't1',
    meetingNumber: 111,
    groupNumber: '1',
    participants: people(n),
  });
}

/** Everyone votes for `candidateId` except the overrides given. */
function everyoneVotes(
  state: GameState,
  candidateId: string,
  overrides: Record<string, string> = {},
): GameState {
  let s = state;
  for (const p of s.participants) {
    const choice = overrides[p.discordId] ?? candidateId;
    const out = castVote(s, p.discordId, choice);
    s = out.state;
    if (out.roundWinnerId) break;
  }
  return s;
}

describe('startSession', () => {
  it('opens at level 6 with everyone a candidate and no votes', () => {
    const s = newGame(4);
    expect(s.status).toBe('active');
    expect(s.currentLevel).toBe(6);
    expect(s.winners).toEqual([]);
    expect(s.votes).toEqual({});
    expect(activeCandidates(s)).toHaveLength(4);
  });

  it('refuses a group below the minimum', () => {
    expect(() =>
      startSession({ threadId: 't', meetingNumber: 1, groupNumber: '1', participants: people(1) }),
    ).toThrow(/at least 2/);
  });
});

describe('votesNeeded', () => {
  it('is a strict majority of the full group, not half and not of the remaining candidates', () => {
    expect(votesNeeded(newGame(4))).toBe(3);
    expect(votesNeeded(newGame(6))).toBe(4);
  });

  it('does not fall as members are eliminated', () => {
    let s = newGame(4);
    s = everyoneVotes(s, 'u2');
    expect(s.winners).toHaveLength(1);
    expect(votesNeeded(s)).toBe(3);
  });
});

describe('the consensus rule', () => {
  it('does not resolve the round until every participant has voted', () => {
    // Three of four vote the same way. That is already a strict majority, but
    // the fourth member has not spoken, so the round stays open.
    let out = castVote(newGame(4), 'u1', 'u2');
    out = castVote(out.state, 'u2', 'u2');
    out = castVote(out.state, 'u3', 'u2');
    expect(out.roundWinnerId).toBeNull();
    expect(out.awaitingVoters).toEqual(['u4']);
    expect(out.state.currentLevel).toBe(6);
  });

  it('resolves once the last voter speaks', () => {
    let out = castVote(newGame(4), 'u1', 'u2');
    out = castVote(out.state, 'u2', 'u2');
    out = castVote(out.state, 'u3', 'u2');
    out = castVote(out.state, 'u4', 'u3');
    expect(out.roundWinnerId).toBe('u2');
    expect(out.awaitingVoters).toEqual([]);
    expect(out.state.currentLevel).toBe(5);
    expect(out.state.votes).toEqual({});
  });

  it('leaves the round open when everyone has voted and nobody has a majority', () => {
    // 2-2 in a group of 4. No tie break exists, so nothing resolves and the
    // group keeps talking. Zaal, 2026-09-01: "No tie break we need consensus
    // to move forward."
    let out = castVote(newGame(4), 'u1', 'u3');
    out = castVote(out.state, 'u2', 'u3');
    out = castVote(out.state, 'u3', 'u4');
    out = castVote(out.state, 'u4', 'u4');
    expect(out.roundWinnerId).toBeNull();
    expect(out.awaitingVoters).toEqual([]);
    expect(out.state.currentLevel).toBe(6);
    expect(out.state.winners).toEqual([]);
  });

  it('resolves when someone changes their mind after a deadlock', () => {
    let out = castVote(newGame(4), 'u1', 'u3');
    out = castVote(out.state, 'u2', 'u3');
    out = castVote(out.state, 'u3', 'u4');
    out = castVote(out.state, 'u4', 'u4');
    out = castVote(out.state, 'u4', 'u3');
    expect(out.previousCandidateId).toBe('u4');
    expect(out.roundWinnerId).toBe('u3');
  });

  it('a strict majority makes two winners arithmetically impossible', () => {
    // The property the whole rule rests on. If this ever fails, a tie state
    // exists and the design has a hole rather than a missing tie break.
    for (const n of [2, 3, 4, 5, 6]) {
      expect(votesNeeded(newGame(n)) * 2).toBeGreaterThan(n);
    }
  });
});

describe('castVote validation', () => {
  it('replaces a voter previous choice rather than adding a second vote', () => {
    const first = castVote(newGame(6), 'u1', 'u2').state;
    const out = castVote(first, 'u1', 'u3');
    expect(out.previousCandidateId).toBe('u2');
    expect(out.state.votes).toEqual({ u1: 'u3' });
  });

  it('rejects a vote from someone who is not in the group', () => {
    const out = castVote(newGame(4), 'stranger', 'u2');
    expect(out.accepted).toBe(false);
    expect(out.reason).toBe('not_participant');
  });

  it('rejects a vote for someone already eliminated', () => {
    const s = everyoneVotes(newGame(4), 'u2');
    const out = castVote(s, 'u1', 'u2');
    expect(out.accepted).toBe(false);
    expect(out.reason).toBe('not_candidate');
  });

  it('rejects votes while paused', () => {
    const s: GameState = { ...newGame(4), status: 'paused' };
    expect(castVote(s, 'u1', 'u2').reason).toBe('session_not_active');
  });
});

describe('session completion', () => {
  it('completes when one candidate remains', () => {
    let s = newGame(3); // strict majority of 3 is 2
    s = everyoneVotes(s, 'u2');
    let out = castVote(s, 'u1', 'u3');
    out = castVote(out.state, 'u2', 'u3');
    out = castVote(out.state, 'u3', 'u3');
    expect(out.sessionComplete).toBe(true);
    expect(out.state.status).toBe('completed');
  });
});

describe('finalRanking', () => {
  it('assigns the Respect ladder by rank and gives the last member the lowest level', () => {
    let s = newGame(3);
    s = everyoneVotes(s, 'u2');
    let out = castVote(s, 'u1', 'u3');
    out = castVote(out.state, 'u2', 'u3');
    out = castVote(out.state, 'u3', 'u3');
    const ranked = finalRanking(out.state);
    expect(ranked.map((r) => [r.discordId, r.level, r.rank, r.respectPoints])).toEqual([
      ['u2', 6, 1, 110],
      ['u3', 5, 2, 68],
      ['u1', 4, 3, 42],
    ]);
  });

  it('refuses to rank a session that is not complete', () => {
    expect(() => finalRanking(newGame(4))).toThrow(/not complete/);
  });
});

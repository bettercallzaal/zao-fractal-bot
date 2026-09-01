import { describe, expect, it } from 'vitest';
import { activeCandidates, castVote, finalRanking, startSession, type GameState } from './session.js';

/** A whole six-person fractal, played the way a real one runs: everybody votes
 * every round, including members who already hold a level. This is the closest
 * thing to the live game that can run without Discord or a database. */
describe('a full six-person fractal', () => {
  it('plays from level 6 to a complete ranking', () => {
    const names = ['Zaal', 'Iman', 'Fellenz', 'MetaMu', 'Hurric4n3ike', 'Tic'];
    let s: GameState = startSession({
      threadId: 'thread-real',
      meetingNumber: 112,
      groupNumber: '1',
      participants: names.map((n, i) => ({
        discordId: `d${i}`,
        displayName: n,
        wallet: `0x${String(i + 1).repeat(40)}`,
      })),
    });

    const log: string[] = [];
    // The group agrees on a different person each round.
    for (const winnerIdx of [1, 3, 0, 5, 2]) {
      const winner = `d${winnerIdx}`;
      expect(activeCandidates(s).some((c) => c.discordId === winner)).toBe(true);
      let resolved = false;
      for (const p of s.participants) {
        const out = castVote(s, p.discordId, winner);
        expect(out.accepted).toBe(true);
        s = out.state;
        if (out.roundWinnerId) {
          log.push(`level ${out.roundWinnerId === winner ? 'ok' : 'WRONG'} -> ${out.roundWinnerId}`);
          resolved = true;
          break;
        }
      }
      expect(resolved).toBe(true);
      if (s.status === 'completed') break;
    }

    expect(s.status).toBe('completed');
    const ranked = finalRanking(s);
    expect(ranked.map((r) => r.respectPoints)).toEqual([110, 68, 42, 26, 16, 10]);
    expect(ranked.map((r) => r.level)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(new Set(ranked.map((r) => r.discordId)).size).toBe(6);
    expect(ranked[0].displayName).toBe('Iman');
    expect(ranked.reduce((sum, r) => sum + r.respectPoints, 0)).toBe(272);
  });

  it('stalls rather than guessing when three and three will not budge', () => {
    let s = startSession({
      threadId: 't',
      meetingNumber: 112,
      groupNumber: '2',
      participants: Array.from({ length: 6 }, (_, i) => ({
        discordId: `d${i}`,
        displayName: `P${i}`,
        wallet: null,
      })),
    });
    // Three for d0, three for d1. Strict majority of 6 is 4, so neither clears.
    for (const [voter, choice] of [
      ['d0', 'd0'], ['d1', 'd0'], ['d2', 'd0'],
      ['d3', 'd1'], ['d4', 'd1'], ['d5', 'd1'],
    ]) {
      s = castVote(s, voter, choice).state;
    }
    expect(s.winners).toEqual([]);
    expect(s.currentLevel).toBe(6);

    // One person moves. Now it resolves - no tie break was ever needed.
    const out = castVote(s, 'd5', 'd0');
    expect(out.roundWinnerId).toBe('d0');
  });
});

/** KNOWN LIMITATION, recorded here rather than discovered on a live Monday.
 *
 * The consensus rule requires every participant to vote before a round is
 * evaluated. If someone drops off the call, closes Discord, or simply never
 * clicks, the round cannot resolve no matter what the rest of the group does.
 * There is no absent-member handling in Phase 1 and no timeout.
 *
 * v1 did not have this problem because it resolved on the first vote to cross
 * the threshold. That behaviour was rejected deliberately (spec 7.1), so this
 * is the cost of the trade, not an oversight.
 *
 * The fix, when it is needed, is a facilitator control to mark someone absent
 * and shrink the group - NOT a tie break, and NOT resolving early. */
describe('known limitation: a silent member blocks the round', () => {
  it('cannot resolve while one participant has not voted, however lopsided the rest', () => {
    let s = startSession({
      threadId: 't',
      meetingNumber: 112,
      groupNumber: '3',
      participants: Array.from({ length: 5 }, (_, i) => ({
        discordId: `d${i}`,
        displayName: `P${i}`,
        wallet: null,
      })),
    });
    // Four of five agree unanimously. d4 never votes.
    for (const voter of ['d0', 'd1', 'd2', 'd3']) {
      const out = castVote(s, voter, 'd0');
      s = out.state;
      expect(out.roundWinnerId).toBeNull();
    }
    const stalled = castVote(s, 'd3', 'd0');
    expect(stalled.awaitingVoters).toEqual(['d4']);
    expect(stalled.roundWinnerId).toBeNull();
    expect(s.winners).toEqual([]);
  });
});

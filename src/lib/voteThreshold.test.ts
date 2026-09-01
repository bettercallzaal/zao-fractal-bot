import { describe, expect, it } from 'vitest';
import { findRoundWinner, majorityThreshold } from './voteThreshold.js';

describe('majorityThreshold', () => {
  it('rounds up for odd group sizes', () => {
    expect(majorityThreshold(5)).toBe(3);
  });

  it('is a STRICT majority for even group sizes, not exactly half', () => {
    // This test previously claimed "strict majority" in its name while
    // asserting 2 of 4 and 3 of 6 - exactly half. It was asserting the bug.
    // Half is not a majority, and with the group of 6 that a fractal caps at
    // it let 3 members decide against the other 3, resolved by whichever
    // third vote arrived first. See the consensus rule in
    // docs/superpowers/specs/2026-09-01-respect-game-core-design.md section 7.
    expect(majorityThreshold(4)).toBe(3);
    expect(majorityThreshold(6)).toBe(4);
  });

  it('makes a tie impossible - two candidates cannot both clear it', () => {
    // Zaal, 2026-09-01: "No tie break we need consensus to move forward."
    // A strict majority is what makes that coherent: no tie state can exist,
    // so there is nothing to break. The round simply stays open.
    for (const n of [2, 3, 4, 5, 6]) {
      expect(majorityThreshold(n) * 2).toBeGreaterThan(n);
    }
  });

  it('returns 1 for a single-member group', () => {
    expect(majorityThreshold(1)).toBe(1);
  });

  it('throws for a group size below 1', () => {
    expect(() => majorityThreshold(0)).toThrow(RangeError);
  });
});

describe('findRoundWinner', () => {
  it('returns null when no candidate has reached the threshold', () => {
    const votes = new Map([['a', 1], ['b', 1]]);
    expect(findRoundWinner(votes, 5)).toBeNull();
  });

  it('returns the candidate once they clear the majority threshold', () => {
    const votes = new Map([['a', 3], ['b', 1]]);
    expect(findRoundWinner(votes, 5)).toBe('a');
  });

  it('a single remaining candidate wins with the threshold-of-1 group size', () => {
    const votes = new Map([['a', 1]]);
    expect(findRoundWinner(votes, 1)).toBe('a');
  });
});

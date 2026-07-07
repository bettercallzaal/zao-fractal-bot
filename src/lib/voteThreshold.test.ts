import { describe, expect, it } from 'vitest';
import { findRoundWinner, majorityThreshold } from './voteThreshold.js';

describe('majorityThreshold', () => {
  it('rounds up for odd group sizes', () => {
    expect(majorityThreshold(5)).toBe(3);
  });

  it('rounds up for even group sizes too (strict majority)', () => {
    expect(majorityThreshold(4)).toBe(2);
    expect(majorityThreshold(6)).toBe(3);
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

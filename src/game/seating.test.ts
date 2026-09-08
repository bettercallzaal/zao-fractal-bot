import { describe, expect, it } from 'vitest';
import type { Participant } from './session.js';
import { seatGroups } from './seating.js';

const people = (prefix: string, n: number): Participant[] =>
  Array.from({ length: n }, (_, i) => ({
    discordId: `${prefix}${i + 1}`,
    displayName: `${prefix}${i + 1}`,
    wallet: null,
  }));

const shape = (present: number, async: number) => {
  const s = seatGroups({ voters: people('v', present), eligibleAsync: people('a', async) });
  return {
    groups: s.groups.map((g) => `${g.voters.length}v+${g.asyncEntrants.length}a`),
    deferred: s.deferred.length,
  };
};

describe('seatGroups - spec 3.1 table', () => {
  it('12 present + 3 async -> three groups of 4 voters + 1 async', () => {
    expect(shape(12, 3)).toEqual({ groups: ['4v+1a', '4v+1a', '4v+1a'], deferred: 0 });
  });

  it('6 present + 2 async -> TWO groups of 3 voters + 1 async', () => {
    // The gap this whole rule exists to close. Seating the room first would
    // make one full group of 6 and turn both async submitters away, every
    // week, forever.
    expect(shape(6, 2)).toEqual({ groups: ['3v+1a', '3v+1a'], deferred: 0 });
  });

  it('6 present + 0 async -> one group of 6, unchanged from today', () => {
    expect(shape(6, 0)).toEqual({ groups: ['6v+0a'], deferred: 0 });
  });

  it('4 present + 2 async -> one group of 4 voters + 2 async', () => {
    expect(shape(4, 2)).toEqual({ groups: ['4v+2a'], deferred: 0 });
  });

  it('3 present + 5 async -> seats 3, defers 2', () => {
    expect(shape(3, 5)).toEqual({ groups: ['3v+3a'], deferred: 2 });
  });

  it('2 present + 5 async -> admits nobody async, defers all 5', () => {
    expect(shape(2, 5)).toEqual({ groups: ['2v+0a'], deferred: 5 });
  });
});

describe('seatGroups - invariants', () => {
  it('defers by earliest submission, keeping the caller order', () => {
    const s = seatGroups({ voters: people('v', 3), eligibleAsync: people('a', 5) });
    expect(s.groups[0].asyncEntrants.map((p) => p.discordId)).toEqual(['a1', 'a2', 'a3']);
    expect(s.deferred.map((p) => p.discordId)).toEqual(['a4', 'a5']);
  });

  it('never exceeds the cap and never starves a group of voters', () => {
    for (let v = 0; v <= 40; v++) {
      for (let a = 0; a <= 20; a++) {
        const s = seatGroups({ voters: people('v', v), eligibleAsync: people('a', a) });
        for (const g of s.groups) {
          expect(g.voters.length + g.asyncEntrants.length).toBeLessThanOrEqual(6);
          if (g.asyncEntrants.length > 0) expect(g.voters.length).toBeGreaterThanOrEqual(3);
        }
        const seated = s.groups.reduce((n, g) => n + g.asyncEntrants.length, 0);
        expect(seated + s.deferred.length).toBe(a);
      }
    }
  });

  it('someone present and also in eligibleAsync is seated once, as a voter, never deferred', () => {
    // Alice submitted async, then showed up. Attending supersedes submitting:
    // she must not consume two seats, and she must not be silently dropped
    // from both the voter count and the async pool.
    const alice: Participant = { discordId: 'alice', displayName: 'alice', wallet: null };
    const voters = [alice, ...people('v', 5)];
    const eligibleAsync = [alice, ...people('a', 2)];
    const s = seatGroups({ voters, eligibleAsync });

    const seatedVoterIds = s.groups.flatMap((g) => g.voters.map((p) => p.discordId));
    const seatedAsyncIds = s.groups.flatMap((g) => g.asyncEntrants.map((p) => p.discordId));

    expect(seatedVoterIds.filter((id) => id === 'alice')).toEqual(['alice']);
    expect(seatedAsyncIds).not.toContain('alice');
    expect(s.deferred.map((p) => p.discordId)).not.toContain('alice');
  });

  it('distributes voters before async entrants', () => {
    // 7 voters + 5 async: voters split 4/3 first, then async fills the
    // emptier group first. No group ends short of voters while another
    // has spares.
    const s = seatGroups({ voters: people('v', 7), eligibleAsync: people('a', 5) });
    expect(s.groups.map((g) => g.voters.length).sort()).toEqual([3, 4]);
    expect(s.groups.every((g) => g.voters.length + g.asyncEntrants.length <= 6)).toBe(true);
  });
});

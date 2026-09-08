// Group allocation for a fractal, including async entrants. Pure: no I/O, no
// discord.js - see src/architecture.test.ts.
//
// The rule this file exists for (spec 2026-09-02 section 3.1): group count is
// derived from the TOTAL candidate pool, not from the room. Under the obvious
// alternative - seat the people present, offer async whatever is left - six
// people present fill one group of six and every async submitter is deferred,
// again the next week, under the same rule, forever. The feature would ship
// and never fire.

import { MAX_GROUP_MEMBERS, MIN_VOTERS } from '@fractalbot/shared';
import type { Participant } from './session.js';

export interface SeatingInput {
  /** Present in the room. */
  voters: Participant[];
  /** Already gated and window-filtered, EARLIEST SUBMISSION FIRST. Order is
   * the deferral rule - see asyncEligibility.ts. */
  eligibleAsync: Participant[];
}

export interface SeatedGroup {
  voters: Participant[];
  asyncEntrants: Participant[];
}

export interface Seating {
  groups: SeatedGroup[];
  /** Async entrants who did not get a seat: over capacity, or below the voter
   * floor. Carried to the next fractal and told so. */
  deferred: Participant[];
}

export function seatGroups(input: SeatingInput): Seating {
  const { voters, eligibleAsync } = input;

  // 1. Admit. Below the floor, nobody is admitted (spec 3.2).
  const admitted = voters.length < MIN_VOTERS ? [] : eligibleAsync;

  // 2. Count groups. Never fewer than one; never so many that a group would
  //    fall under the voter floor.
  const byPool = Math.ceil((voters.length + admitted.length) / MAX_GROUP_MEMBERS);
  const byFloor = Math.floor(voters.length / MIN_VOTERS);
  const groupCount = Math.max(1, Math.min(byPool, byFloor));

  const groups: SeatedGroup[] = Array.from({ length: groupCount }, () => ({
    voters: [],
    asyncEntrants: [],
  }));

  const size = (g: SeatedGroup): number => g.voters.length + g.asyncEntrants.length;
  const smallest = (): SeatedGroup =>
    groups.reduce((min, g) => (size(g) < size(min) ? g : min), groups[0]);

  // 3. Seat. Voters first, so groups balance on the people who actually vote;
  //    async entrants then fill the emptiest groups. Same greedy round-robin
  //    as distributeIntoGroups in randomize.ts.
  for (const v of voters) smallest().voters.push(v);

  const seats = groupCount * MAX_GROUP_MEMBERS - voters.length;
  const seated = admitted.slice(0, Math.max(seats, 0));
  for (const a of seated) smallest().asyncEntrants.push(a);

  // Derived from eligibleAsync rather than from admitted, so the below-floor
  // case (admitted === []) defers everyone instead of dropping them silently.
  const seatedIds = new Set(seated.map((p) => p.discordId));
  const deferred = eligibleAsync.filter((p) => !seatedIds.has(p.discordId));

  return { groups, deferred };
}

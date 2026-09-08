// Pure elimination-game engine. No I/O, no discord.js, no Supabase - see
// src/architecture.test.ts and spec section 3. Every function takes state and
// returns new state; nothing here mutates its input.
//
// Ported in behaviour from fractalbotapril2026 cogs/fractal/group.py, with one
// deliberate and load-bearing difference: the consensus rule in spec section
// 7.1. v1 read the tally after every vote and broke ties at random. This waits
// for every participant to vote and uses a strict majority, so a tie cannot
// arise and there is nothing to break. A split group does not resolve until
// somebody changes their mind, which is the intent rather than a deadlock.

import {
  MAX_GROUP_MEMBERS,
  MIN_GROUP_MEMBERS,
  MIN_VOTERS,
  RESPECT_POINTS,
  STARTING_LEVEL,
} from '@fractalbot/shared';
import { findRoundWinner, majorityThreshold } from '../lib/voteThreshold.js';

export interface Participant {
  discordId: string;
  displayName: string;
  wallet: string | null;
}

export interface LevelWinner {
  level: number;
  discordId: string;
}

export type SessionStatus = 'active' | 'completed' | 'paused';

export interface GameState {
  threadId: string;
  meetingNumber: number;
  groupNumber: string;
  status: SessionStatus;
  currentLevel: number;
  /** Every candidate: the room plus the async entrants. */
  participants: Participant[];
  /** The subset of `participants` who submitted async. They are ranked like
   * anyone else and never vote - spec 2026-09-02 section 2. Derivation runs
   * this way round, rather than holding two lists, because section 9 requires
   * the existing 16 tests to pass unmodified. */
  asyncEntrantIds: string[];
  winners: LevelWinner[];
  /** voterDiscordId -> candidateDiscordId, current round only. */
  votes: Record<string, string>;
}

export interface VoteOutcome {
  state: GameState;
  accepted: boolean;
  reason?: 'session_not_active' | 'not_participant' | 'not_candidate';
  previousCandidateId: string | null;
  roundWinnerId: string | null;
  /** Who the round is still waiting on. Empty and no winner means the group
   * has voted and not agreed - the round stays open on purpose. */
  awaitingVoters: string[];
  sessionComplete: boolean;
}

export interface RankedMember {
  discordId: string;
  displayName: string;
  wallet: string | null;
  level: number;
  rank: number;
  respectPoints: number;
}

export function startSession(input: {
  threadId: string;
  meetingNumber: number;
  groupNumber: string;
  participants: Participant[];
  asyncEntrantIds?: string[];
}): GameState {
  const asyncEntrantIds = input.asyncEntrantIds ?? [];

  if (input.participants.length < MIN_GROUP_MEMBERS) {
    throw new RangeError(
      `A fractal needs at least ${MIN_GROUP_MEMBERS} members, got ${input.participants.length}`,
    );
  }

  // RESPECT_POINTS has exactly MAX_GROUP_MEMBERS entries and finalRanking pays
  // RESPECT_POINTS[index] ?? 0, so a seventh candidate would silently earn
  // nothing. Fail loudly instead. The seating layer also caps this; both are
  // wanted, because this is the last line before a real payout.
  if (input.participants.length > MAX_GROUP_MEMBERS) {
    throw new RangeError(
      `A fractal group holds at most ${MAX_GROUP_MEMBERS} candidates including async entrants, got ${input.participants.length}`,
    );
  }

  const ids = new Set(input.participants.map((p) => p.discordId));
  for (const id of asyncEntrantIds) {
    if (!ids.has(id)) {
      throw new RangeError(`asyncEntrantIds: ${id} is not a participant`);
    }
  }

  // The floor guards the VOTER count, not the candidate count. Without this,
  // one voter plus five async entrants gives a votesNeeded of 1 - one person
  // unilaterally ranking five absent people. Spec section 3.2. Derived the
  // same way voters() is - counting participants not in the async set -
  // rather than by subtracting lengths, so a duplicated id in
  // asyncEntrantIds cannot make this guard disagree with voters().
  const asyncIdSet = new Set(asyncEntrantIds);
  const voterCount = input.participants.filter((p) => !asyncIdSet.has(p.discordId)).length;
  if (asyncEntrantIds.length > 0 && voterCount < MIN_VOTERS) {
    throw new RangeError(
      `A fractal with async entrants needs at least ${MIN_VOTERS} voters, got ${voterCount}`,
    );
  }

  return {
    threadId: input.threadId,
    meetingNumber: input.meetingNumber,
    groupNumber: input.groupNumber,
    status: 'active',
    currentLevel: STARTING_LEVEL,
    participants: input.participants,
    asyncEntrantIds,
    winners: [],
    votes: {},
  };
}

/** Present in the room. The only people whose votes count and the only people
 * a round waits for. */
export function voters(state: GameState): Participant[] {
  const isAsync = new Set(state.asyncEntrantIds);
  return state.participants.filter((p) => !isAsync.has(p.discordId));
}

/** Ranked without attending. Votable-for, never voted-with. */
export function asyncEntrants(state: GameState): Participant[] {
  const isAsync = new Set(state.asyncEntrantIds);
  return state.participants.filter((p) => isAsync.has(p.discordId));
}

export function activeCandidates(state: GameState): Participant[] {
  const won = new Set(state.winners.map((w) => w.discordId));
  return state.participants.filter((p) => !won.has(p.discordId));
}

/** Strict majority of the VOTERS - everyone present, including members who
 * already hold a level, so the bar does not fall as the candidate pool
 * shrinks. Async entrants are excluded: counting them would raise the
 * threshold using people who cannot cast a vote, and every round they touched
 * would deadlock. That is the failure already recorded as the passing test
 * "known limitation: a silent member blocks the round". */
export function votesNeeded(state: GameState): number {
  return majorityThreshold(voters(state).length);
}

export function awaitingVoters(state: GameState): string[] {
  return voters(state)
    .filter((p) => !(p.discordId in state.votes))
    .map((p) => p.discordId);
}

export function castVote(state: GameState, voterId: string, candidateId: string): VoteOutcome {
  const unchanged = (reason: VoteOutcome['reason']): VoteOutcome => ({
    state,
    accepted: false,
    reason,
    previousCandidateId: null,
    roundWinnerId: null,
    awaitingVoters: awaitingVoters(state),
    sessionComplete: false,
  });

  if (state.status !== 'active') return unchanged('session_not_active');
  if (!voters(state).some((p) => p.discordId === voterId)) return unchanged('not_participant');
  if (!activeCandidates(state).some((p) => p.discordId === candidateId)) {
    return unchanged('not_candidate');
  }

  const previousCandidateId = state.votes[voterId] ?? null;
  const votes = { ...state.votes, [voterId]: candidateId };
  const voted: GameState = { ...state, votes };

  const stillOut = awaitingVoters(voted);
  if (stillOut.length > 0) {
    // The consensus rule: do not read the tally until the group has spoken.
    return {
      state: voted,
      accepted: true,
      previousCandidateId,
      roundWinnerId: null,
      awaitingVoters: stillOut,
      sessionComplete: false,
    };
  }

  const tally = new Map<string, number>();
  // Iterate voters rather than the votes map. The denominator on the next line
  // is the voter count, so a ballot from anyone who is not a voter would be
  // counted in the numerator and not in the denominator - a candidate could
  // clear the threshold on a ghost vote. castVote cannot currently insert such
  // a key, but a rehydrated session could carry one.
  for (const v of voters(voted)) {
    const choice = votes[v.discordId];
    if (choice === undefined) continue;
    tally.set(choice, (tally.get(choice) ?? 0) + 1);
  }

  // A strict majority means at most one candidate can clear, so this is the
  // winner or there is none. No tie is representable.
  const winnerId = findRoundWinner(tally, voters(state).length);
  if (!winnerId) {
    return {
      state: voted,
      accepted: true,
      previousCandidateId,
      roundWinnerId: null,
      awaitingVoters: [],
      sessionComplete: false,
    };
  }

  const winners = [...state.winners, { level: state.currentLevel, discordId: winnerId }];
  const nextLevel = state.currentLevel - 1;
  const complete = state.participants.length - winners.length <= 1 || nextLevel < 1;

  return {
    state: {
      ...state,
      votes: {},
      winners,
      currentLevel: nextLevel,
      status: complete ? 'completed' : state.status,
    },
    accepted: true,
    previousCandidateId,
    roundWinnerId: winnerId,
    awaitingVoters: [],
    sessionComplete: complete,
  };
}

/** Ranked highest level first, with the Respect each member earned. The one
 * member never voted a level takes the next level down, as in group.py
 * end_fractal. */
export function finalRanking(state: GameState): RankedMember[] {
  if (state.status !== 'completed') {
    throw new Error('finalRanking: session is not complete');
  }
  const byId = new Map(state.participants.map((p) => [p.discordId, p]));
  const ordered = [...state.winners].sort((a, b) => b.level - a.level);

  const leftover = activeCandidates(state);
  const lowestAssigned = ordered.length > 0 ? ordered[ordered.length - 1].level : STARTING_LEVEL + 1;
  ordered.push(
    ...leftover.map((p, i) => ({ level: lowestAssigned - 1 - i, discordId: p.discordId })),
  );

  return ordered.map((w, index) => {
    const p = byId.get(w.discordId);
    if (!p) throw new Error(`finalRanking: no participant for ${w.discordId}`);
    return {
      discordId: p.discordId,
      displayName: p.displayName,
      wallet: p.wallet,
      level: w.level,
      rank: index + 1,
      respectPoints: RESPECT_POINTS[index] ?? 0,
    };
  });
}

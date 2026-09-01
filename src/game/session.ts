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

import { MIN_GROUP_MEMBERS, RESPECT_POINTS, STARTING_LEVEL } from '@fractalbot/shared';
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
  participants: Participant[];
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
}): GameState {
  if (input.participants.length < MIN_GROUP_MEMBERS) {
    throw new RangeError(
      `A fractal needs at least ${MIN_GROUP_MEMBERS} members, got ${input.participants.length}`,
    );
  }
  return {
    threadId: input.threadId,
    meetingNumber: input.meetingNumber,
    groupNumber: input.groupNumber,
    status: 'active',
    currentLevel: STARTING_LEVEL,
    participants: input.participants,
    winners: [],
    votes: {},
  };
}

export function activeCandidates(state: GameState): Participant[] {
  const won = new Set(state.winners.map((w) => w.discordId));
  return state.participants.filter((p) => !won.has(p.discordId));
}

/** Strict majority of the FULL group. Everyone votes every round, including
 * members who already hold a level, so the bar does not fall as the candidate
 * pool shrinks. */
export function votesNeeded(state: GameState): number {
  return majorityThreshold(state.participants.length);
}

export function awaitingVoters(state: GameState): string[] {
  return state.participants.filter((p) => !(p.discordId in state.votes)).map((p) => p.discordId);
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
  if (!state.participants.some((p) => p.discordId === voterId)) return unchanged('not_participant');
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
  for (const choice of Object.values(votes)) {
    tally.set(choice, (tally.get(choice) ?? 0) + 1);
  }

  // A strict majority means at most one candidate can clear, so this is the
  // winner or there is none. No tie is representable.
  const winnerId = findRoundWinner(tally, state.participants.length);
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

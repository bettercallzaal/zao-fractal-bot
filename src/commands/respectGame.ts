// Orchestration for the Respect Game. Loads state, calls the pure engine,
// persists, returns plain JSON. No discord.js - see src/architecture.test.ts.
//
// The ordering rule in castFractalVote is the point of the whole spec: the
// vote is written BEFORE the outcome is returned, and a write failure rejects.
// A caller can therefore never show a round advancing that the database does
// not have.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  castVote,
  finalRanking,
  type GameState,
  type Participant,
  type RankedMember,
  startSession,
  type VoteOutcome,
  votesNeeded as computeVotesNeeded,
} from '../game/session.js';
import * as repo from '../lib/gameRepo.js';

export interface GameActionContext {
  supabase: SupabaseClient;
}

export async function startFractal(
  params: {
    threadId: string;
    guildId: string;
    facilitatorDiscordId: string;
    name: string;
    meetingNumber: number;
    groupNumber: string;
    participants: Participant[];
  },
  ctx: GameActionContext,
): Promise<{ sessionId: string; state: GameState; votesNeeded: number }> {
  const state = startSession({
    threadId: params.threadId,
    meetingNumber: params.meetingNumber,
    groupNumber: params.groupNumber,
    participants: params.participants,
  });
  const stored = await repo.createSession(ctx.supabase, {
    state,
    name: params.name,
    guildId: params.guildId,
    facilitatorDiscordId: params.facilitatorDiscordId,
  });
  return { sessionId: stored.sessionId, state, votesNeeded: computeVotesNeeded(state) };
}

export async function castFractalVote(
  params: {
    sessionId: string;
    state: GameState;
    voterDiscordId: string;
    candidateDiscordId: string;
  },
  ctx: GameActionContext,
): Promise<VoteOutcome & { sessionId: string; ranking: RankedMember[] | null }> {
  const levelBefore = params.state.currentLevel;
  const outcome = castVote(params.state, params.voterDiscordId, params.candidateDiscordId);

  if (!outcome.accepted) {
    return { ...outcome, sessionId: params.sessionId, ranking: null };
  }

  await repo.recordVote(ctx.supabase, {
    sessionId: params.sessionId,
    level: levelBefore,
    votesNeeded: computeVotesNeeded(params.state),
    voterDiscordId: params.voterDiscordId,
    candidateDiscordId: params.candidateDiscordId,
  });

  if (outcome.roundWinnerId) {
    await repo.resolveRound(ctx.supabase, {
      sessionId: params.sessionId,
      level: levelBefore,
      winnerDiscordId: outcome.roundWinnerId,
    });
  }

  let ranking: RankedMember[] | null = null;
  if (outcome.sessionComplete) {
    ranking = finalRanking(outcome.state);
    await repo.completeSession(ctx.supabase, { sessionId: params.sessionId, ranking });
  }

  return { ...outcome, sessionId: params.sessionId, ranking };
}

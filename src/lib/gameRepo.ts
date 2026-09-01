// The only file that reads or writes live game state in Supabase.
//
// Every write is awaited and every error is thrown. There is deliberately no
// fire-and-forget path here.
//
// MEASURED 2026-09-01, and this is the reason the file is shaped this way: the
// deployed v1 bot's .env contains no Supabase credentials at all. Its only
// write path was ZAO OS's webhook, whose own header reads "fire-and-forget
// semantics (10s timeout)". So the game ran correctly every week and recorded
// nothing from 2026-03-23 onward, and nobody found out for five months. See
// docs/superpowers/specs/2026-09-01-respect-game-core-design.md sections 1
// and 10.
//
// Tables live in the ZAO OS project (efsxtoxvigqowjhgcbiz). A different
// Supabase project has its own unrelated bot_commands table with different
// columns - see spec section 4 before pointing this anywhere else.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GameState, RankedMember } from '../game/session.js';

export interface StoredSession {
  sessionId: string;
  state: GameState;
}

export async function createSession(
  sb: SupabaseClient,
  args: { state: GameState; name: string; guildId: string; facilitatorDiscordId: string },
): Promise<StoredSession> {
  const { state } = args;
  const { data, error } = await sb
    .from('fractal_sessions')
    .insert({
      name: args.name,
      status: 'active',
      session_date: new Date().toISOString().slice(0, 10),
      meeting_number: state.meetingNumber,
      group_number: state.groupNumber,
      thread_id: state.threadId,
      discord_thread_id: state.threadId,
      guild_id: args.guildId,
      facilitator_discord_id: args.facilitatorDiscordId,
      participant_count: state.participants.length,
    })
    .select('id')
    .single();
  if (error) throw new Error(`createSession: ${error.message}`);
  const sessionId = (data as { id?: string } | null)?.id;
  if (!sessionId) throw new Error('createSession: insert returned no id');

  // The roster is persisted here, not just held in memory, because
  // loadSessionByThread rehydrates participants from it after a restart.
  // Without this write, resume would come back with an empty group.
  const roster = await sb.from('discord_roster').insert(
    state.participants.map((p) => ({
      session_id: sessionId,
      discord_id: p.discordId,
      display_name: p.displayName,
      wallet_address: p.wallet,
      sources: ['thread'],
      confidence: 'manual',
      captured_at: new Date().toISOString(),
    })),
  );
  if (roster.error) throw new Error(`createSession (roster): ${roster.error.message}`);

  return { sessionId, state };
}

/** Full rehydration: session, participants, level winners and the votes of the
 * round that was open. A crash during a live call must not cost the group the
 * round - Zaal moved this into Phase 1 on 2026-09-01. */
export async function loadSessionByThread(
  sb: SupabaseClient,
  threadId: string,
): Promise<StoredSession | null> {
  const session = await sb
    .from('fractal_sessions')
    .select('id, meeting_number, group_number, thread_id, status')
    .eq('thread_id', threadId)
    .maybeSingle();
  if (session.error) throw new Error(`loadSessionByThread: ${session.error.message}`);
  if (!session.data) return null;
  const row = session.data as {
    id: string;
    meeting_number: number | null;
    group_number: string | null;
    thread_id: string;
    status: GameState['status'];
  };

  const roster = await sb
    .from('discord_roster')
    .select('discord_id, display_name, wallet_address')
    .eq('session_id', row.id);
  if (roster.error) throw new Error(`loadSessionByThread (roster): ${roster.error.message}`);

  const rounds = await sb
    .from('discord_fractal_rounds')
    .select('id, level, winner_discord_id, resolved_at')
    .eq('session_id', row.id)
    .order('level', { ascending: false });
  if (rounds.error) throw new Error(`loadSessionByThread (rounds): ${rounds.error.message}`);

  const roundRows = (rounds.data ?? []) as {
    id: string;
    level: number;
    winner_discord_id: string | null;
    resolved_at: string | null;
  }[];

  const winners = roundRows
    .filter((r) => r.resolved_at !== null && r.winner_discord_id !== null)
    .map((r) => ({ level: r.level, discordId: r.winner_discord_id as string }));

  const open = roundRows.find((r) => r.resolved_at === null);
  let votes: Record<string, string> = {};
  if (open) {
    const cast = await sb
      .from('discord_fractal_votes')
      .select('voter_discord_id, candidate_discord_id')
      .eq('round_id', open.id);
    if (cast.error) throw new Error(`loadSessionByThread (votes): ${cast.error.message}`);
    votes = Object.fromEntries(
      ((cast.data ?? []) as { voter_discord_id: string; candidate_discord_id: string }[]).map(
        (v) => [v.voter_discord_id, v.candidate_discord_id],
      ),
    );
  }

  // Resume on the open round if there is one, otherwise one below the lowest
  // level already won.
  const currentLevel = open
    ? open.level
    : winners.length > 0
      ? Math.min(...winners.map((w) => w.level)) - 1
      : 6;

  return {
    sessionId: row.id,
    state: {
      threadId: row.thread_id,
      meetingNumber: row.meeting_number ?? 0,
      groupNumber: row.group_number ?? '1',
      status: row.status,
      currentLevel,
      participants: (
        (roster.data ?? []) as {
          discord_id: string;
          display_name: string;
          wallet_address: string | null;
        }[]
      ).map((r) => ({
        discordId: r.discord_id,
        displayName: r.display_name,
        wallet: r.wallet_address,
      })),
      winners,
      votes,
    },
  };
}

/** Opens the round row if it is not there yet, then upserts the vote. The
 * unique constraint on (round_id, voter_discord_id) is what makes a changed
 * vote a replacement rather than a duplicate. */
export async function recordVote(
  sb: SupabaseClient,
  args: {
    sessionId: string;
    level: number;
    votesNeeded: number;
    voterDiscordId: string;
    candidateDiscordId: string;
  },
): Promise<void> {
  const round = await sb
    .from('discord_fractal_rounds')
    .upsert(
      { session_id: args.sessionId, level: args.level, votes_needed: args.votesNeeded },
      { onConflict: 'session_id,level' },
    );
  if (round.error) throw new Error(`recordVote (round): ${round.error.message}`);

  const roundId = await roundIdFor(sb, args.sessionId, args.level);

  const vote = await sb.from('discord_fractal_votes').upsert(
    {
      round_id: roundId,
      voter_discord_id: args.voterDiscordId,
      candidate_discord_id: args.candidateDiscordId,
      cast_at: new Date().toISOString(),
    },
    { onConflict: 'round_id,voter_discord_id' },
  );
  if (vote.error) throw new Error(`recordVote (vote): ${vote.error.message}`);
}

async function roundIdFor(sb: SupabaseClient, sessionId: string, level: number): Promise<string> {
  const { data, error } = await sb
    .from('discord_fractal_rounds')
    .select('id')
    .eq('session_id', sessionId)
    .eq('level', level)
    .maybeSingle();
  if (error) throw new Error(`roundIdFor: ${error.message}`);
  const id = (data as { id?: string } | null)?.id;
  if (!id) throw new Error(`roundIdFor: no round row for session ${sessionId} level ${level}`);
  return id;
}

export async function resolveRound(
  sb: SupabaseClient,
  args: { sessionId: string; level: number; winnerDiscordId: string },
): Promise<void> {
  const { error } = await sb
    .from('discord_fractal_rounds')
    .update({ winner_discord_id: args.winnerDiscordId, resolved_at: new Date().toISOString() })
    .eq('session_id', args.sessionId)
    .eq('level', args.level);
  if (error) throw new Error(`resolveRound: ${error.message}`);
}

export async function completeSession(
  sb: SupabaseClient,
  args: { sessionId: string; ranking: RankedMember[] },
): Promise<void> {
  const scores = await sb.from('fractal_scores').insert(
    args.ranking.map((r) => ({
      session_id: args.sessionId,
      member_name: r.displayName,
      wallet_address: r.wallet,
      discord_id: r.discordId,
      rank: r.rank,
      level: r.level,
      score: r.respectPoints,
      respect_points: r.respectPoints,
    })),
  );
  if (scores.error) throw new Error(`completeSession (scores): ${scores.error.message}`);

  const session = await sb
    .from('fractal_sessions')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', args.sessionId);
  if (session.error) throw new Error(`completeSession (session): ${session.error.message}`);
}
